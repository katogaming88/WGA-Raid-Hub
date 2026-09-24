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

-- ---------------------------------------------------------------------------
-- /wgacrafts: the gear the professions can craft this expansion.
--
-- Use: open each crafting profession window once (Blacksmithing, Leatherworking,
-- Tailoring, Jewelcrafting, Engineering, Inscription ...). Each time a window
-- opens its recipes are noted. Then type /wgacrafts for the list.
--   /wgacrafts         shows what has been noted so far
--   /wgacrafts reset   forgets it and starts again
-- The list keeps armor, weapons and jewelry from recipes filed under
-- EXPANSION, and the window ends with a count per profession so a profession
-- you have not opened (or one that opened empty) is easy to spot.
-- ---------------------------------------------------------------------------

local EXPANSION = "Midnight"

-- itemEquipLoc -> the catalog's slot names.
local EQUIP_SLOTS = {
  INVTYPE_HEAD = "Head", INVTYPE_NECK = "Neck", INVTYPE_SHOULDER = "Shoulder",
  INVTYPE_CLOAK = "Back", INVTYPE_CHEST = "Chest", INVTYPE_ROBE = "Chest",
  INVTYPE_WRIST = "Wrist", INVTYPE_HAND = "Hands", INVTYPE_WAIST = "Waist",
  INVTYPE_LEGS = "Legs", INVTYPE_FEET = "Feet", INVTYPE_FINGER = "Finger",
  INVTYPE_TRINKET = "Trinket", INVTYPE_WEAPON = "One-Hand",
  INVTYPE_WEAPONMAINHAND = "One-Hand", INVTYPE_2HWEAPON = "Two-Hand",
  INVTYPE_WEAPONOFFHAND = "Off Hand", INVTYPE_SHIELD = "Off Hand",
  INVTYPE_HOLDABLE = "Held In Off-hand", INVTYPE_RANGED = "Ranged",
  INVTYPE_RANGEDRIGHT = "Ranged", INVTYPE_THROWN = "Ranged",
}
local ARMOR_CLASS, WEAPON_CLASS = 4, 2

local noted = {} -- item id -> { profession, recipe }
local perProfession = {} -- profession -> recipes seen

-- The expansion a recipe is filed under is its top category in the window.
local function ExpansionOf(recipeInfo)
  local id = recipeInfo and recipeInfo.categoryID
  local name
  while id do
    local cat = C_TradeSkillUI.GetCategoryInfo(id)
    if not cat then break end
    name = cat.name
    id = cat.parentCategoryID
  end
  return name
end

local function NoteOpenProfession()
  local base = C_TradeSkillUI.GetBaseProfessionInfo()
  local profession = base and base.professionName
  if not profession or profession == "" then return end
  local ids = C_TradeSkillUI.GetAllRecipeIDs()
  if not ids or #ids == 0 then return end
  local seen = 0
  for _, recipeID in ipairs(ids) do
    local info = C_TradeSkillUI.GetRecipeInfo(recipeID)
    local top = ExpansionOf(info)
    if top and top:find(EXPANSION, 1, true) then
      local schematic = C_TradeSkillUI.GetRecipeSchematic(recipeID, false)
      local itemID = schematic and schematic.outputItemID
      if itemID then
        seen = seen + 1
        if not noted[itemID] then
          noted[itemID] = { profession = profession, recipe = info.name or "" }
          C_Item.RequestLoadItemDataByID(itemID)
        end
      end
    end
  end
  perProfession[profession] = math.max(perProfession[profession] or 0, seen)
end

local craftEvents = CreateFrame("Frame")
craftEvents:RegisterEvent("TRADE_SKILL_LIST_UPDATE")
craftEvents:SetScript("OnEvent", function()
  pcall(NoteOpenProfession)
end)

local function CraftedLines()
  local lines, notLoaded, kept = {}, 0, 0
  local ids = {}
  for itemID in pairs(noted) do ids[#ids + 1] = itemID end
  table.sort(ids)
  for _, itemID in ipairs(ids) do
    local name, _, _, _, _, _, _, _, equipLoc, _, _, classID, subclassID = C_Item.GetItemInfo(itemID)
    if not name then
      notLoaded = notLoaded + 1
    elseif (classID == ARMOR_CLASS or classID == WEAPON_CLASS) and EQUIP_SLOTS[equipLoc] then
      kept = kept + 1
      local kind = ""
      if classID == ARMOR_CLASS then
        kind = C_Item.GetItemSubClassInfo and C_Item.GetItemSubClassInfo(ARMOR_CLASS, subclassID) or ""
      else
        kind = C_Item.GetItemSubClassInfo and C_Item.GetItemSubClassInfo(WEAPON_CLASS, subclassID) or ""
      end
      lines[#lines + 1] = table.concat({
        noted[itemID].profession, noted[itemID].recipe, itemID, name, EQUIP_SLOTS[equipLoc], kind or "",
      }, " | ")
    end
  end
  local names = {}
  for profession, count in pairs(perProfession) do names[#names + 1] = profession end
  table.sort(names)
  for _, profession in ipairs(names) do
    lines[#lines + 1] = "-- " .. profession .. ": " .. perProfession[profession] .. " " .. EXPANSION .. " recipes seen"
  end
  if #names == 0 then
    lines[#lines + 1] = "-- No profession window has been opened yet. Open each one, then run /wgacrafts."
  end
  lines[#lines + 1] = "-- " .. kept .. " gear items from crafting"
  return table.concat(lines, "\n"), notLoaded
end

local function ShowCrafts(attempt)
  local ok, text, notLoaded = pcall(CraftedLines)
  if not ok then
    print("WGA Loot Dump (crafts) failed: " .. tostring(text))
    return
  end
  if notLoaded > 0 and attempt < 6 then
    print("WGA Loot Dump: " .. notLoaded .. " item names still loading, trying again...")
    C_Timer.After(2, function() ShowCrafts(attempt + 1) end)
    return
  end
  if notLoaded > 0 then
    text = text .. "\n-- " .. notLoaded .. " item names never loaded: run /wgacrafts again."
  end
  Show(text)
end

SLASH_WGACRAFTS1 = "/wgacrafts"
SlashCmdList["WGACRAFTS"] = function(msg)
  if strtrim(msg or ""):lower() == "reset" then
    noted, perProfession = {}, {}
    print("WGA Loot Dump: forgot the noted recipes.")
    return
  end
  ShowCrafts(1)
end
