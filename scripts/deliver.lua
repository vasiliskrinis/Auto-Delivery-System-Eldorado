--[[
  Auto-Delivery for Grow a Garden 2
  Inject this with your executor while inside the game.

  It connects to the Node.js bridge running on your Mac (npm start)
  and delivers mail orders automatically.

  If something doesn't work, enable DEBUG = true below to print
  what the script finds in the game tree.
--]]

local SERVER        = "http://127.0.0.1:7890"
local POLL_INTERVAL = 2   -- seconds between polls
local DEBUG         = false

-- ── services ──────────────────────────────────────────────────────────────────
local Players       = game:GetService("Players")
local HttpService   = game:GetService("HttpService")
local TweenService  = game:GetService("TweenService")
local LocalPlayer   = Players.LocalPlayer
local PlayerGui     = LocalPlayer:WaitForChild("PlayerGui")

-- ── helpers ───────────────────────────────────────────────────────────────────

local function log(msg)
    print("[AutoDeliver] " .. tostring(msg))
end

local function dbg(msg)
    if DEBUG then print("[AutoDeliver:DBG] " .. tostring(msg)) end
end

local function httpGet(url)
    local ok, res = pcall(request, { Url = url, Method = "GET" })
    if ok then return res end
    -- some executors use syn.request
    local ok2, res2 = pcall(syn and syn.request or request, { Url = url, Method = "GET" })
    if ok2 then return res2 end
    return nil
end

local function httpPost(url, body)
    pcall(request, {
        Url     = url,
        Method  = "POST",
        Headers = { ["Content-Type"] = "application/json" },
        Body    = body,
    })
end

local function complete(success, err)
    httpPost(SERVER .. "/complete", HttpService:JSONEncode({
        success = success,
        error   = err or "",
    }))
end

-- Find a descendant by exact text or name (TextButton, TextLabel, Frame …)
local function findByText(parent, text)
    for _, v in ipairs(parent:GetDescendants()) do
        if (v:IsA("TextButton") or v:IsA("TextLabel") or v:IsA("Frame"))
           and (v.Text == text or (v:FindFirstChildOfClass("TextLabel") and v:FindFirstChildOfClass("TextLabel").Text == text)) then
            return v
        end
    end
    return nil
end

local function findButton(parent, text)
    for _, v in ipairs(parent:GetDescendants()) do
        if v:IsA("TextButton") and v.Visible and v.Text:lower():find(text:lower(), 1, true) then
            return v
        end
    end
    return nil
end

local function findTextBox(parent)
    for _, v in ipairs(parent:GetDescendants()) do
        if v:IsA("TextBox") and v.Visible then
            return v
        end
    end
    return nil
end

local function clickButton(btn)
    if not btn then return end
    dbg("Clicking: " .. btn:GetFullName())
    btn.MouseButton1Down:Fire()
    task.wait(0.05)
    btn.MouseButton1Up:Fire()
    btn.MouseButton1Click:Fire()
    task.wait(0.3)
end

local function waitForGui(name, timeout)
    timeout = timeout or 10
    local deadline = tick() + timeout
    while tick() < deadline do
        for _, gui in ipairs(PlayerGui:GetChildren()) do
            if gui.Name:lower():find(name:lower(), 1, true) then
                return gui
            end
        end
        task.wait(0.25)
    end
    return nil
end

-- Debug helper: print all current GUIs
local function printGuis()
    log("Current GUIs in PlayerGui:")
    for _, v in ipairs(PlayerGui:GetChildren()) do
        log("  " .. v.Name .. " (" .. v.ClassName .. ")")
    end
end

-- ── mailbox interaction ────────────────────────────────────────────────────────

local function findMailbox()
    -- Search workspace for anything named Mailbox / Mail Box / MailBox
    for _, obj in ipairs(workspace:GetDescendants()) do
        if obj.Name:lower():find("mailbox", 1, true) or obj.Name:lower():find("mail_box", 1, true) then
            dbg("Found mailbox candidate: " .. obj:GetFullName())
            return obj
        end
    end
    return nil
end

local function openMailbox()
    local mb = findMailbox()
    if not mb then
        return false, "Mailbox object not found in workspace — are you near it?"
    end

    -- Try ProximityPrompt
    local prompt = mb:FindFirstChildOfClass("ProximityPrompt")
    if not prompt then
        -- Search children recursively
        for _, v in ipairs(mb:GetDescendants()) do
            if v:IsA("ProximityPrompt") then prompt = v; break end
        end
    end

    if prompt then
        dbg("Firing ProximityPrompt on " .. mb.Name)
        fireproximityprompt(prompt)
        task.wait(1)
        return true
    end

    -- Try ClickDetector
    local cd = mb:FindFirstChildOfClass("ClickDetector")
    if not cd then
        for _, v in ipairs(mb:GetDescendants()) do
            if v:IsA("ClickDetector") then cd = v; break end
        end
    end
    if cd then
        dbg("Firing ClickDetector on " .. mb.Name)
        fireclickdetector(cd)
        task.wait(1)
        return true
    end

    return false, "No ProximityPrompt or ClickDetector found on mailbox"
end

-- ── delivery flow ─────────────────────────────────────────────────────────────

local function deliver(order)
    local username = order.username
    local item     = order.item
    local qty      = order.quantity

    log(string.format("Starting delivery: %dx %s → @%s", qty, item, username))

    if DEBUG then printGuis() end

    -- Step 1: open mailbox
    local ok, err = openMailbox()
    if not ok then return false, err end

    -- Step 2: wait for mailbox GUI to open, then click "Mailbox View" if needed
    task.wait(0.8)
    if DEBUG then printGuis() end

    -- Look for "Mailbox View" option
    local mbViewBtn = findButton(PlayerGui, "Mailbox View")
    if mbViewBtn then
        log("Clicking 'Mailbox View'")
        clickButton(mbViewBtn)
        task.wait(0.8)
    end

    -- Step 3: click "Mail" button
    local mailBtn = findButton(PlayerGui, "Mail")
    if not mailBtn then
        task.wait(1)
        mailBtn = findButton(PlayerGui, "Mail")
    end
    if not mailBtn then
        return false, "Could not find the Mail button in any GUI"
    end
    log("Clicking 'Mail' button")
    clickButton(mailBtn)
    task.wait(1)

    -- Step 4: type username in the search field
    local searchBox = findTextBox(PlayerGui)
    if not searchBox then
        task.wait(1)
        searchBox = findTextBox(PlayerGui)
    end
    if not searchBox then
        return false, "Could not find the username search field"
    end
    log("Typing username: " .. username)
    searchBox:CaptureFocus()
    searchBox.Text = username
    task.wait(1.5)

    -- Step 5: click the first autocomplete result
    -- Results usually appear as buttons with the player's name
    local resultBtn = findButton(PlayerGui, username)
    if not resultBtn then
        -- Try finding any new button that appeared (first child after typing)
        for _, v in ipairs(PlayerGui:GetDescendants()) do
            if v:IsA("TextButton") and v.Visible
               and v.Text ~= "" and v.Text ~= "Mail" and v.Text ~= "Send"
               and v.Text:lower():find(username:lower():sub(1,3), 1, true) then
                resultBtn = v
                break
            end
        end
    end
    if resultBtn then
        log("Selecting player: " .. resultBtn.Text)
        clickButton(resultBtn)
        task.wait(1)
    else
        log("WARNING: could not find autocomplete result for " .. username .. " — hoping selection happened anyway")
    end

    -- Step 6: find the item in inventory and click it
    log("Looking for item: " .. item)
    task.wait(0.5)
    local itemBtn = findButton(PlayerGui, item)
    if not itemBtn then
        -- Scroll and search
        local scrollFrame = nil
        for _, v in ipairs(PlayerGui:GetDescendants()) do
            if v:IsA("ScrollingFrame") and v.Visible then
                scrollFrame = v
                break
            end
        end

        if scrollFrame then
            log("Scrolling inventory to find item…")
            -- Scroll to top first
            scrollFrame.CanvasPosition = Vector2.new(0, 0)
            task.wait(0.3)

            local found = false
            for i = 1, 20 do
                itemBtn = findButton(scrollFrame, item)
                if itemBtn then found = true; break end
                scrollFrame.CanvasPosition = scrollFrame.CanvasPosition + Vector2.new(0, 100)
                task.wait(0.3)
            end

            if not found then
                return false, "Item '" .. item .. "' not found in inventory — is it in your mailbox inventory?"
            end
        else
            if not itemBtn then
                return false, "Item '" .. item .. "' not found — no scrolling frame either"
            end
        end
    end

    log("Clicking item: " .. item)
    clickButton(itemBtn)
    task.wait(0.6)

    -- Step 7: click Send
    local sendBtn = findButton(PlayerGui, "Send")
    if not sendBtn then
        task.wait(0.5)
        sendBtn = findButton(PlayerGui, "Send")
    end
    if not sendBtn then
        return false, "Could not find the Send button"
    end
    log("Clicking Send")
    clickButton(sendBtn)
    task.wait(1)

    -- Step 8: close the panel if a close button appeared
    local closeBtn = findButton(PlayerGui, "Close") or findButton(PlayerGui, "X")
    if closeBtn then
        clickButton(closeBtn)
        task.wait(0.5)
    end

    log(string.format("Done — %dx %s sent to @%s", qty, item, username))
    return true
end

-- ── poll loop ─────────────────────────────────────────────────────────────────

log("Running — polling " .. SERVER .. " every " .. POLL_INTERVAL .. "s")
log("Enable DEBUG = true at the top to print GUI tree info")

while true do
    local resp = httpGet(SERVER .. "/next-order")

    if resp and resp.StatusCode == 200 and resp.Body and #resp.Body > 0 then
        local ok, order = pcall(HttpService.JSONDecode, HttpService, resp.Body)

        if ok and order then
            log(string.format("Order received: %dx %s → @%s", order.quantity, order.item, order.username))

            local success, errMsg = pcall(function()
                return deliver(order)
            end)

            if success and errMsg == true then
                complete(true)
            elseif success and type(errMsg) == "string" then
                -- deliver returned false, reason
                complete(false, errMsg)
            else
                complete(false, tostring(errMsg))
            end
        end
    end

    task.wait(POLL_INTERVAL)
end
