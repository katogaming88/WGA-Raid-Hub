-- WGA_LootDump: lists the Mythic loot of chosen dungeons, as the Adventure
-- Guide shows it, so the season's M+ item list comes from the game itself
-- rather than from Wowhead (#1166).
--
-- Use: /wgaloot        dumps the dungeons in DUNGEONS below
--      /wgaloot all    dumps every dungeon in every expansion
-- A window opens with one line per item. Press Ctrl+A, Ctrl+C, and paste it
-- to Claude. Open the Adventure Guide once first so the game loads its data.
--
-- Each season, edit DUNGEONS to that season's pool. Names must match the
-- Adventure Guide exactly. Also runs on the PTR.
--
-- Output line: instance | boss | item id | item name | slot | armor type
-- ASCII only: the WoW client reads this file.

local DUNGEONS = {
  "Altar of Fangs",
  "Den of Nalorakk",
  "Kings' Rest",
  "Murder Row",
  "Ruby Life Pools",
  "Temple of Sethraliss",
  "The Blinding Vale",
  "Voidscar Arena",
}

local MYTHIC_DUNGEON = 23 -- difficulty id of "(5) Mythic"

local function LoadJournal()
  if not C_AddOns.IsAddOnLoaded("Blizzard_EncounterJournal") then
    C_AddOns.LoadAddOn("Blizzard_EncounterJournal")
  end
end

-- name -> instance id, across every expansion tab.
local function FindInstances()
  local found = {}
  for tier = 1, EJ_GetNumTiers() do
    EJ_SelectTier(tier)
    local i = 1
    while true do
      local id, name = EJ_GetInstanceByIndex(i, false)
      if not id then break end
      -- The same name can exist in two expansions; keep the newest tab.
      found[name] = id
      i = i + 1
    end
  end
  return found
end

local function LootInfo(index)
  if C_EncounterJournal and C_EncounterJournal.GetLootInfoByIndex then
    return C_EncounterJournal.GetLootInfoByIndex(index)
  end
  local itemID, encounterID, name, _, slot, armorType = EJ_GetLootInfoByIndex(index)
  return { itemID = itemID, encounterID = encounterID, name = name, slot = slot, armorType = armorType }
end

local function Dump(all)
  LoadJournal()
  -- The guide filters loot to your own class and spec. 0, 0 shows everyone's.
  EJ_SetLootFilter(0, 0)
  if C_EncounterJournal and C_EncounterJournal.ResetSlotFilter then
    C_EncounterJournal.ResetSlotFilter()
  end

  local instances = FindInstances()
  local wanted = DUNGEONS
  if all then
    wanted = {}
    for name in pairs(instances) do wanted[#wanted + 1] = name end
    table.sort(wanted)
  end

  local lines, notLoaded, missing = {}, 0, {}
  for _, dungeon in ipairs(wanted) do
    local instanceID = instances[dungeon]
    if not instanceID then
      missing[#missing + 1] = dungeon
    else
      EJ_SelectInstance(instanceID)
      EJ_SetDifficulty(MYTHIC_DUNGEON)
      local e = 1
      while true do
        local boss, _, encounterID = EJ_GetEncounterInfoByIndex(e)
        if not boss then break end
        EJ_SelectEncounter(encounterID)
        local count = EJ_GetNumLoot()
        local seen = {}
        for n = 1, count do
          local info = LootInfo(n)
          if info and info.itemID and not seen[info.itemID] then
            seen[info.itemID] = true
            if not info.name then notLoaded = notLoaded + 1 end
            local slot = info.slot or ""
            if info.name and slot == "" then slot = "(no slot: not gear)" end
            lines[#lines + 1] = table.concat({
              dungeon, boss, info.itemID, info.name or "?", slot, info.armorType or "",
            }, " | ")
          end
        end
        lines[#lines + 1] = "-- " .. dungeon .. " / " .. boss .. ": " .. count .. " rows"
        e = e + 1
      end
    end
  end

  if #missing > 0 then
    lines[#lines + 1] = "-- NOT FOUND in the Adventure Guide: " .. table.concat(missing, "; ")
  end
  return table.concat(lines, "\n"), notLoaded
end

local frame
local function Show(text)
  if not frame then
    frame = CreateFrame("Frame", "WGALootDumpFrame", UIParent, "BasicFrameTemplateWithInset")
    frame:SetSize(760, 480)
    frame:SetPoint("CENTER")
    frame:SetFrameStrata("DIALOG")
    frame.TitleText:SetText("WGA Loot Dump - Ctrl+A, Ctrl+C, then paste to Claude")
    local scroll = CreateFrame("ScrollFrame", "WGALootDumpScroll", frame, "UIPanelScrollFrameTemplate")
    scroll:SetPoint("TOPLEFT", 12, -32)
    scroll:SetPoint("BOTTOMRIGHT", -32, 12)
    local edit = CreateFrame("EditBox", nil, scroll)
    edit:SetMultiLine(true)
    edit:SetAutoFocus(false)
    edit:SetFontObject(ChatFontNormal)
    edit:SetWidth(700)
    edit:SetScript("OnEscapePressed", function() frame:Hide() end)
    scroll:SetScrollChild(edit)
    frame.edit = edit
  end
  frame.edit:SetText(text)
  frame.edit:HighlightText()
  frame:Show()
  frame.edit:SetFocus()
end

SLASH_WGALOOT1 = "/wgaloot"
-- Item names load a moment after the guide asks for them, so run again until
-- every name is there (up to 6 tries, 2 seconds apart).
local function Run(all, attempt)
  local ok, result, notLoaded = pcall(Dump, all)
  if not ok then
    print("WGA Loot Dump failed: " .. tostring(result))
    return
  end
  if notLoaded > 0 and attempt < 6 then
    print("WGA Loot Dump: " .. notLoaded .. " item names still loading, trying again...")
    C_Timer.After(2, function() Run(all, attempt + 1) end)
    return
  end
  if notLoaded > 0 then
    result = result .. "\n-- " .. notLoaded .. " item names never loaded: run /wgaloot again."
  end
  Show(result)
end

SlashCmdList["WGALOOT"] = function(msg)
  Run(strtrim(msg or ""):lower() == "all", 1)
end
