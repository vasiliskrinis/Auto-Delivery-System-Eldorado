--[[
  Auto-Delivery for Grow a Garden 2 — direct remote version.

  Instead of clicking the UI, this calls the game's own mailbox network
  remotes (the same ones the in-game Mail panel uses), discovered from the
  decompiled client:
      NetworkRemotes.Mailbox.LookupPlayer:Fire(username)  -> userId
      NetworkRemotes.Mailbox.SendBatch:Fire(userId, batch, note)

  Inject this with your executor while you are in the game. It connects to
  the Node.js bridge (npm start) on your Mac and fulfils mail orders.

  Set DEBUG = true to print what it finds while troubleshooting.
--]]

local SERVER        = "http://127.0.0.1:7890"
local POLL_INTERVAL = 2
local DEBUG         = false

-- ── services ──────────────────────────────────────────────────────────────────
local Players         = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local HttpService     = game:GetService("HttpService")
local LocalPlayer     = Players.LocalPlayer

-- ── logging ───────────────────────────────────────────────────────────────────
local function log(msg) print("[AutoDeliver] " .. tostring(msg)) end
local function dbg(msg) if DEBUG then print("[AutoDeliver:DBG] " .. tostring(msg)) end end

-- ── http ──────────────────────────────────────────────────────────────────────
local httpRequest = (syn and syn.request)
    or (http and http.request)
    or http_request
    or request

local function httpGet(url)
    if not httpRequest then return nil end
    local ok, res = pcall(httpRequest, { Url = url, Method = "GET" })
    if ok then return res end
    return nil
end

local function httpPost(url, body)
    pcall(httpRequest, {
        Url     = url,
        Method  = "POST",
        Headers = { ["Content-Type"] = "application/json" },
        Body    = body,
    })
end

local function complete(success, err)
    httpPost(SERVER .. "/complete", HttpService:JSONEncode({
        success = success and true or false,
        error   = err or "",
    }))
end

-- ── locate NetworkRemotes ──────────────────────────────────────────────────────
-- The decompiled client references NetworkRemotes.Mailbox.{LookupPlayer,SendBatch}.
-- These are a networking-library wrapper (objects with :Fire), not raw remotes,
-- so we locate the already-loaded table rather than touching instances.

local NetworkRemotes = nil

local function looksLikeNetworkRemotes(t)
    if type(t) ~= "table" then return false end
    local ok, mb = pcall(function() return t.Mailbox end)
    if not ok or type(mb) ~= "table" then return false end
    local ok2, send = pcall(function() return mb.SendBatch end)
    local ok3, look = pcall(function() return mb.LookupPlayer end)
    return ok2 and send ~= nil and ok3 and look ~= nil
end

-- Confirm a candidate's remotes are genuinely live: LookupPlayer on our own
-- name must return our own UserId. A decoy/stale table won't pass this.
local function validateRemotes(t)
    local ok, uid = pcall(function()
        return t.Mailbox.LookupPlayer:Fire(LocalPlayer.Name)
    end)
    if ok and type(uid) == "number" and uid == LocalPlayer.UserId then
        return true
    end
    return false, uid
end

local function findNetworkRemotes()
    local candidates = {}

    -- 1. Collect candidates from the garbage collector (live tables).
    if type(getgc) == "function" then
        local ok, gc = pcall(getgc, true)
        if ok and type(gc) == "table" then
            for _, obj in ipairs(gc) do
                if looksLikeNetworkRemotes(obj) then
                    table.insert(candidates, { src = "getgc", obj = obj })
                end
            end
        end
    end

    -- 2. Collect candidates by requiring likely ModuleScripts.
    for _, m in ipairs(ReplicatedStorage:GetDescendants()) do
        if m:IsA("ModuleScript") then
            local n = m.Name:lower()
            if n:find("network") or n:find("remote") or n:find("net") then
                local ok, res = pcall(require, m)
                if ok and looksLikeNetworkRemotes(res) then
                    table.insert(candidates, { src = "require:" .. m:GetFullName(), obj = res })
                end
            end
        end
    end

    dbg("NetworkRemotes candidates found: " .. #candidates)

    -- Prefer a candidate that passes the live self-test.
    for _, c in ipairs(candidates) do
        if validateRemotes(c.obj) then
            log("NetworkRemotes verified live via " .. c.src)
            return c.obj
        end
    end

    -- None validated — fall back to the first shaped candidate but warn.
    if candidates[1] then
        log("WARNING: NetworkRemotes found but self-test did not pass — using first candidate (" .. candidates[1].src .. ")")
        return candidates[1].obj
    end

    return nil
end

-- ── inventory access (lifted from decompiled client) ───────────────────────────
local PlayerStateClientCache = nil

local function getPlayerStateClient()
    if PlayerStateClientCache then return PlayerStateClientCache end
    pcall(function()
        local clientModules = ReplicatedStorage:FindFirstChild("ClientModules")
        local module = clientModules and clientModules:FindFirstChild("PlayerStateClient")
        if module then
            PlayerStateClientCache = require(module)
        end
    end)
    return PlayerStateClientCache
end

local function getLocalInventoryData()
    local client = getPlayerStateClient()
    if not client or not client.GetLocalReplica then return nil end
    local ok, replica = pcall(function() return client:GetLocalReplica() end)
    if ok and replica and replica.Data and type(replica.Data.Inventory) == "table" then
        return replica.Data.Inventory
    end
    return nil
end

local function resolveMailItemName(category, itemKey, entryValue)
    if type(entryValue) == "table" then
        local parts = {}
        local mutation = entryValue.Mutation
        local petType  = entryValue.Type
        local size     = entryValue.Size
        local name     = entryValue.FruitName or entryValue.Name or itemKey
        if petType and petType ~= "" then table.insert(parts, tostring(petType)) end
        if size and size ~= "" then table.insert(parts, tostring(size)) end
        table.insert(parts, tostring(name))
        if mutation and mutation ~= "" then table.insert(parts, "[" .. tostring(mutation) .. "]") end
        return table.concat(parts, " ")
    end
    return tostring(itemKey)
end

local function isMailboxGiftable(category, itemKey, entryValue)
    local giftable = {
        Pets = true, Sprinklers = true, WateringCans = true, Mushrooms = true,
        Gnomes = true, Raccoons = true, Crates = true, SeedPacks = true,
        Trowels = true, Props = true, Seeds = true, HarvestedFruits = true,
        EmptyPots = true,
    }
    if not giftable[category] then return false end
    if category == "HarvestedFruits" then
        return type(entryValue) == "table" and entryValue.Id ~= nil
    end
    if category == "Pets" then
        return type(entryValue) == "table" and entryValue.Id ~= nil and entryValue.Equipped ~= true
    end
    return type(entryValue) == "number" and entryValue > 0
end

local CATEGORIES = {
    "Pets", "Sprinklers", "WateringCans", "Mushrooms", "Gnomes", "Raccoons",
    "Crates", "SeedPacks", "Trowels", "Props", "Seeds", "HarvestedFruits", "EmptyPots",
}

-- Returns an array of grouped giftable items: { Category, Display, Count, Stackable, Entries }
local function buildMailGroups()
    local inventory = getLocalInventoryData()
    local grouped, order = {}, {}
    if type(inventory) == "table" then
        for _, category in ipairs(CATEGORIES) do
            local bucket = inventory[category]
            if type(bucket) == "table" then
                for itemKey, entryValue in pairs(bucket) do
                    if isMailboxGiftable(category, itemKey, entryValue) then
                        local display = resolveMailItemName(category, itemKey, entryValue)
                        local groupKey, addCount
                        if category == "Pets" or category == "HarvestedFruits" then
                            groupKey = category .. ":" .. display
                            addCount = 1
                        else
                            groupKey = category .. ":" .. tostring(itemKey)
                            addCount = tonumber(entryValue) or 0
                        end
                        if not grouped[groupKey] then
                            grouped[groupKey] = {
                                Category  = category,
                                Display   = display,
                                Count     = 0,
                                Stackable = not (category == "Pets" or category == "HarvestedFruits"),
                                Entries   = {},
                            }
                            table.insert(order, groupKey)
                        end
                        grouped[groupKey].Count = grouped[groupKey].Count + addCount
                        table.insert(grouped[groupKey].Entries, {
                            Category = category,
                            ItemKey  = itemKey,
                            Count    = addCount,
                        })
                    end
                end
            end
        end
    end
    local list = {}
    for _, key in ipairs(order) do
        table.insert(list, grouped[key])
    end
    return list
end

local function norm(s)
    return tostring(s):lower():gsub("%s+", ""):gsub("%[.-%]", "")
end

local function findMailItem(itemName)
    local groups = buildMailGroups()
    log("Inventory has " .. #groups .. " giftable item group(s):")
    for _, g in ipairs(groups) do
        log(string.format("   - %s [%s] x%d", g.Display, g.Category, g.Count))
    end

    local want = norm(itemName)
    -- If the requested name mentions "seed", strongly prefer the Seeds category
    -- so we don't grab a grown plant / fruit of the same base name.
    local wantsSeed = tostring(itemName):lower():find("seed", 1, true) ~= nil

    local function score(g)
        local d = norm(g.Display)
        local exact   = (d == want)
        local dHasW   = d:find(want, 1, true) ~= nil
        local wHasD   = want:find(d, 1, true) ~= nil
        if not (exact or dHasW or wHasD) then return -1 end
        local s = 0
        if exact then s = s + 100 end
        if dHasW then s = s + 30 end
        if wHasD then s = s + 20 end
        -- Category preference
        if wantsSeed and g.Category == "Seeds" then s = s + 50 end
        if wantsSeed and g.Category ~= "Seeds" then s = s - 25 end
        -- Closer length = better
        s = s - math.abs(#d - #want)
        return s
    end

    local best, bestScore = nil, -1
    for _, g in ipairs(groups) do
        local sc = score(g)
        if sc > bestScore then best, bestScore = g, sc end
    end

    if best and bestScore >= 0 then
        log(string.format("Matched '%s' -> %s [%s] (score %d)", itemName, best.Display, best.Category, bestScore))
        return best
    end
    return nil
end

local function buildMailBatchItems(mailItem, amount)
    if not mailItem then return {} end
    local target = tonumber(amount)
    if not target or target <= 0 then target = mailItem.Count end
    target = math.min(math.floor(target), mailItem.Count or 0)
    local batches = {}
    if target <= 0 then return batches end
    if mailItem.Stackable then
        local entry = mailItem.Entries[1]
        if entry then
            table.insert(batches, { {
                Category = entry.Category,
                ItemKey  = entry.ItemKey,
                Count    = target,
            } })
        end
        return batches
    end
    local sent = 0
    for _, entry in ipairs(mailItem.Entries) do
        if sent >= target then break end
        table.insert(batches, { {
            Category = entry.Category,
            ItemKey  = entry.ItemKey,
            Count    = 1,
        } })
        sent = sent + 1
    end
    return batches
end

-- ── username → userId ──────────────────────────────────────────────────────────
local function resolveTargetUserId(username)
    local target = tostring(username or ""):gsub("^%s*@?", ""):gsub("%s+$", "")
    if target == "" then return nil end

    -- Preferred: the game's own lookup remote
    if NetworkRemotes and NetworkRemotes.Mailbox and NetworkRemotes.Mailbox.LookupPlayer then
        local ok, userId = pcall(function()
            return NetworkRemotes.Mailbox.LookupPlayer:Fire(target)
        end)
        if ok and type(userId) == "number" and userId > 0 then
            return userId
        end
    end

    -- Fallback: Roblox's public user API
    local ok, id = pcall(function()
        return Players:GetUserIdFromNameAsync(target)
    end)
    if ok and type(id) == "number" and id > 0 then
        return id
    end

    return nil
end

-- ── delivery ───────────────────────────────────────────────────────────────────
local function deliver(order)
    local username = order.username
    local item     = order.item
    local qty       = tonumber(order.quantity) or 1

    log(string.format("Delivering %dx %s -> @%s", qty, item, username))

    if not NetworkRemotes or not NetworkRemotes.Mailbox or not NetworkRemotes.Mailbox.SendBatch then
        return false, "NetworkRemotes.Mailbox.SendBatch not found — open the game fully first"
    end

    local userId = resolveTargetUserId(username)
    if not userId then
        return false, "Could not resolve username '" .. tostring(username) .. "'"
    end
    log("Resolved @" .. username .. " -> userId " .. userId)

    local mailItem = findMailItem(item)
    if not mailItem then
        return false, "Item '" .. tostring(item) .. "' not found in your giftable inventory"
    end
    if mailItem.Count < qty then
        return false, string.format("Not enough '%s' — have %d, need %d", mailItem.Display, mailItem.Count, qty)
    end

    local batches = buildMailBatchItems(mailItem, qty)
    if #batches == 0 then
        return false, "Nothing to send (amount resolved to 0)"
    end

    local note = "Auto-delivery — thanks for your purchase!"
    local sent = 0
    for _, batch in ipairs(batches) do
        local entry = batch[1]
        log(string.format("SendBatch -> userId=%d  Category=%s  ItemKey=%s  Count=%s",
            userId, tostring(entry.Category), tostring(entry.ItemKey), tostring(entry.Count)))
        local ok, success, message = pcall(function()
            return NetworkRemotes.Mailbox.SendBatch:Fire(userId, batch, note)
        end)
        log(string.format("  -> ok=%s success=%s message=%s",
            tostring(ok), tostring(success), tostring(message)))
        if ok and success then
            sent = sent + 1
        else
            return false, "SendBatch rejected: " .. tostring(message or "server returned false")
        end
        task.wait(mailItem.Stackable and 0.2 or 0.4)
    end

    log(string.format("Sent %d/%d batch(es) of %s to @%s", sent, #batches, mailItem.Display, username))
    return sent > 0, sent > 0 and nil or "No batches sent"
end

-- ── startup ────────────────────────────────────────────────────────────────────
log("Starting up…")

-- Check HTTP support up front so failures are obvious.
if not httpRequest then
    log("ERROR: Your executor has no HTTP request function (request/syn.request).")
    log("       This script cannot talk to the bridge without it.")
    log("       Tell the bot owner so we can switch to file-based mode.")
    return
end
do
    local ping = httpGet(SERVER .. "/ping")
    if ping and ping.StatusCode == 200 then
        log("HTTP + bridge connection OK ✓ (executor supports requests)")
    else
        log("WARNING: Could not reach the bridge at " .. SERVER)
        log("         Is 'npm start' running on the same machine? Continuing to poll…")
    end
end

log("Locating game remotes…")
NetworkRemotes = findNetworkRemotes()
if NetworkRemotes then
    log("NetworkRemotes located ✓")
    -- Self-test: confirm LookupPlayer resolves our own name to our own id.
    local okSelf, selfId = validateRemotes(NetworkRemotes)
    if okSelf then
        log("Self-test OK ✓ — LookupPlayer(" .. LocalPlayer.Name .. ") = " .. LocalPlayer.UserId)
    else
        log("WARNING: Self-test FAILED — LookupPlayer returned: " .. tostring(selfId))
        log("         The located remotes may be a decoy. Mail may silently fail.")
    end
else
    log("WARNING: NetworkRemotes not found yet — will retry when an order arrives.")
    log("         Make sure you are fully loaded into the game.")
end

if getLocalInventoryData() then
    log("Inventory access OK ✓")
else
    log("WARNING: inventory not readable yet (PlayerStateClient). Will retry per order.")
end

log("Polling " .. SERVER .. " every " .. POLL_INTERVAL .. "s. Leave this running.")

-- ── poll loop ──────────────────────────────────────────────────────────────────
while true do
    local resp = httpGet(SERVER .. "/next-order")

    if resp and resp.StatusCode == 200 and resp.Body and #resp.Body > 0 then
        local ok, order = pcall(function() return HttpService:JSONDecode(resp.Body) end)
        if ok and type(order) == "table" and order.item then
            -- Lazily (re)locate remotes if startup was too early
            if not NetworkRemotes then NetworkRemotes = findNetworkRemotes() end

            local ranOk, successOrErr, errMsg = pcall(deliver, order)
            if ranOk then
                if successOrErr == true then
                    complete(true)
                else
                    complete(false, errMsg or "delivery returned false")
                end
            else
                complete(false, tostring(successOrErr))
            end
        end
    end

    task.wait(POLL_INTERVAL)
end
