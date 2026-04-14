local WsUrl = "ws://localhost:9000"
local MaxCompletionItems = 120
local MaxScriptResults = 250
local WebSocketApi = WebSocket
local DecompileFunction = decompile

local BlacklistedPaths = {
    workspace,
    game:GetService("Players"),
    game:GetService("StarterGui"),
    game:GetService("CorePackages"),
    game:GetService("CoreGui")
}

local ScriptIndexById = {}
local ScriptRecords = {}
local NextScriptId = 0

local function ToLower(Value)
    return string.lower(Value or "")
end

local function Trim(Value)
    return (Value or ""):match("^%s*(.-)%s*$")
end

local function SafeGetFullName(Instance)
    local Ok, FullName = pcall(function()
        return Instance:GetFullName()
    end)
    if Ok and FullName then
        return FullName
    end
    return Instance.Name
end

local function IsDescendantOfBlacklistedPath(Instance)
    for _, PathRoot in ipairs(BlacklistedPaths) do
        local Ok, IsDescendant = pcall(function()
            return Instance:IsDescendantOf(PathRoot)
        end)
        if Ok and IsDescendant then
            return true
        end
    end
    return false
end

local function IsAllowedScript(Instance)
    if not Instance then
        return false
    end

    if not (Instance:IsA("BaseScript") or Instance:IsA("ModuleScript")) then
        return false
    end

    if IsDescendantOfBlacklistedPath(Instance) then
        return false
    end

    return true
end

local function BuildDotPath(Instance)
    local Parts = {}
    local Current = Instance
    while Current and Current ~= game do
        table.insert(Parts, 1, Current.Name)
        Current = Current.Parent
    end

    if #Parts == 0 then
        return "game"
    end

    local Path = "game:GetService('" .. Parts[1] .. "')"
    for Index = 2, #Parts do
        Path = Path .. "." .. Parts[Index]
    end
    return Path
end

local function SplitDotPath(Path)
    local Parts = {}
    if not Path or Path == "" then
        return Parts
    end
    for Part in string.gmatch(Path, "([%w_]+)") do
        table.insert(Parts, Part)
    end
    return Parts
end

local function StartsWithIgnoreCase(Text, Prefix)
    if not Prefix or Prefix == "" then
        return true
    end
    return string.lower(string.sub(Text, 1, #Prefix)) == string.lower(Prefix)
end

local function CloneScriptForDecompile(Instance)
    local Ok, Clone = pcall(Instance.Clone, Instance)
    if not Ok or not Clone then
        return nil
    end

    if Clone:IsA("BaseScript") then
        Clone.Enabled = false
    end

    Clone.Parent = nil
    return Clone
end

local function AddScriptToIndex(Instance)
    if not IsAllowedScript(Instance) then
        return
    end

    NextScriptId += 1
    local ScriptId = tostring(NextScriptId)
    local Path = SafeGetFullName(Instance)
    local CachedClone = CloneScriptForDecompile(Instance)

    local Record = {
        Id = ScriptId,
        Name = Instance.Name,
        NameLower = ToLower(Instance.Name),
        ClassName = Instance.ClassName,
        ClassLower = ToLower(Instance.ClassName),
        Path = Path,
        PathLower = ToLower(Path),
        LiveScript = Instance,
        CachedScript = CachedClone
    }

    ScriptIndexById[ScriptId] = Record
    table.insert(ScriptRecords, Record)
end

local function BuildScriptIndex()
    ScriptIndexById = {}
    ScriptRecords = {}
    NextScriptId = 0

    local Ok, Descendants = pcall(function()
        return game:GetDescendants()
    end)
    if not Ok then
        return
    end

    for _, Instance in ipairs(Descendants) do
        AddScriptToIndex(Instance)
    end
end

local function EnsureScriptIndex()
    if #ScriptRecords == 0 then
        BuildScriptIndex()
    end
end

local function TokenizeQuery(Query)
    local Tokens = {}
    local Normalized = ToLower(Trim(Query))
    for Token in string.gmatch(Normalized, "[^%s]+") do
        table.insert(Tokens, Token)
    end
    return Tokens, Normalized
end

local function MatchesTokens(Record, Tokens)
    if #Tokens == 0 then
        return true
    end

    for _, Token in ipairs(Tokens) do
        local InName = string.find(Record.NameLower, Token, 1, true)
        local InPath = string.find(Record.PathLower, Token, 1, true)
        local InClass = string.find(Record.ClassLower, Token, 1, true)
        if not InName and not InPath and not InClass then
            return false
        end
    end

    return true
end

local function RankRecord(Record, NormalizedQuery)
    if NormalizedQuery == "" then
        return 1
    end

    local Score = 0
    if string.sub(Record.NameLower, 1, #NormalizedQuery) == NormalizedQuery then
        Score += 200
    elseif string.find(Record.NameLower, NormalizedQuery, 1, true) then
        Score += 120
    end

    if string.find(Record.PathLower, NormalizedQuery, 1, true) then
        Score += 60
    end

    if string.find(Record.ClassLower, NormalizedQuery, 1, true) then
        Score += 20
    end

    return Score
end

local function SearchScripts(Query, Limit)
    EnsureScriptIndex()

    local Results = {}
    local Tokens, NormalizedQuery = TokenizeQuery(Query)
    local MaxResults = math.max(1, math.min(Limit or MaxScriptResults, MaxScriptResults))

    for _, Record in ipairs(ScriptRecords) do
        if MatchesTokens(Record, Tokens) then
            table.insert(Results, {
                id = Record.Id,
                name = Record.Name,
                className = Record.ClassName,
                path = Record.Path,
                _score = RankRecord(Record, NormalizedQuery)
            })
        end
    end

    table.sort(Results, function(Left, Right)
        if Left._score ~= Right._score then
            return Left._score > Right._score
        end
        if Left.name ~= Right.name then
            return ToLower(Left.name) < ToLower(Right.name)
        end
        return Left.path < Right.path
    end)

    if #Results > MaxResults then
        for Index = #Results, MaxResults + 1, -1 do
            table.remove(Results, Index)
        end
    end

    for _, Item in ipairs(Results) do
        Item._score = nil
    end

    return Results
end

local function ResolveDecompileTarget(Record)
    if Record.CachedScript then
        return Record.CachedScript
    end
    return Record.LiveScript
end

local function DecompileScript(ScriptId)
    local Record = ScriptIndexById[ScriptId]
    if not Record then
        return nil, "Script not found in current index. Refresh search and retry."
    end

    local Target = ResolveDecompileTarget(Record)
    if not Target then
        return nil, "No script target available for decompile."
    end

    if DecompileFunction and type(DecompileFunction) == "function" then
        local Ok, Decompiled = pcall(function()
            return DecompileFunction(Target)
        end)
        if Ok and type(Decompiled) == "string" and Decompiled ~= "" then
            return "-- " .. Record.Path .. "\n" .. Decompiled
        end
    end

    local Ok, Source = pcall(function()
        return Target.Source
    end)
    if Ok and type(Source) == "string" and Source ~= "" then
        return "-- " .. Record.Path .. "\n" .. Source
    end

    return nil, "Decompiler unavailable or returned empty output."
end

local function ExtractNumberField(Raw, Key)
    local Pattern = '"' .. Key .. '"%s*:%s*(%d+)'
    local Match = Raw:match(Pattern)
    if not Match then
        return nil
    end
    return tonumber(Match)
end

local function JsonEncode(Value)
    local ValueType = type(Value)
    if Value == nil then
        return "null"
    elseif ValueType == "boolean" then
        return tostring(Value)
    elseif ValueType == "number" then
        return tostring(Value)
    elseif ValueType == "string" then
        return '"' .. Value
            :gsub('\\', '\\\\')
            :gsub('"', '\\"')
            :gsub('\n', '\\n')
            :gsub('\r', '\\r')
            :gsub('\t', '\\t') .. '"'
    elseif ValueType == "table" then
        if #Value > 0 then
            local Parts = {}
            for _, Item in ipairs(Value) do
                table.insert(Parts, JsonEncode(Item))
            end
            return "[" .. table.concat(Parts, ",") .. "]"
        end

        local Parts = {}
        for Key, Item in pairs(Value) do
            table.insert(Parts, JsonEncode(tostring(Key)) .. ":" .. JsonEncode(Item))
        end
        return "{" .. table.concat(Parts, ",") .. "}"
    end

    return "null"
end

local function ExtractStringField(Raw, Key)
    local Pattern = '"' .. Key .. '"%s*:%s*"([^"]*)"'
    return Raw:match(Pattern)
end

local function ExtractType(Raw)
    return ExtractStringField(Raw, "type")
end

local function ResolveRoot(Scope, ServiceName, PathParts)
    if Scope == "service" then
        if not ServiceName or ServiceName == "" then
            return nil, PathParts
        end
        local Ok, Service = pcall(function()
            return game:GetService(ServiceName)
        end)
        if not Ok then
            return nil, PathParts
        end
        return Service, PathParts
    end

    if Scope == "workspace" then
        local Ok, WorkspaceService = pcall(function()
            return game:GetService("Workspace")
        end)
        if not Ok then
            return nil, PathParts
        end
        return WorkspaceService, PathParts
    end

    if Scope == "game" then
        if #PathParts == 0 then
            return game, PathParts
        end

        local First = PathParts[1]
        local Ok, Service = pcall(function()
            return game:GetService(First)
        end)

        if Ok and Service then
            table.remove(PathParts, 1)
            return Service, PathParts
        end

        local Child = game:FindFirstChild(First)
        if Child then
            table.remove(PathParts, 1)
            return Child, PathParts
        end

        return game, PathParts
    end

    return nil, PathParts
end

local function TraverseToTarget(Root, PathParts)
    local Current = Root
    for _, Segment in ipairs(PathParts) do
        if not Current then
            return nil
        end
        Current = Current:FindFirstChild(Segment)
        if not Current then
            return nil
        end
    end
    return Current
end

local function CollectChildren(Parent, Prefix)
    local Results = {}
    if not Parent then
        return Results
    end

    local Ok, Children = pcall(function()
        return Parent:GetChildren()
    end)
    if not Ok then
        return Results
    end

    for _, Child in ipairs(Children) do
        if StartsWithIgnoreCase(Child.Name, Prefix) then
            table.insert(Results, {
                label = Child.Name,
                detail = Child.ClassName,
                path = BuildDotPath(Child)
            })
            if #Results >= MaxCompletionItems then
                break
            end
        end
    end

    table.sort(Results, function(Left, Right)
        return string.lower(Left.label) < string.lower(Right.label)
    end)

    return Results
end

local function ComputeCompletions(Scope, ServiceName, Path, Prefix)
    local PathParts = SplitDotPath(Path)
    local Root, Remaining = ResolveRoot(Scope, ServiceName, PathParts)
    if not Root then
        return {}
    end

    local Target = TraverseToTarget(Root, Remaining)
    if not Target then
        return {}
    end

    return CollectChildren(Target, Prefix)
end

local function Connect()
    local WebSocketConnection = WebSocketApi and WebSocketApi.connect and WebSocketApi.connect(WsUrl)

    if not WebSocketConnection then
        warn("[Rotellisense] No WebSocket API found in this executor.")
        return
    end

    print("[Rotellisense] Connected to " .. WsUrl)

    local function Send(Payload)
        local Ok, ErrorMessage = pcall(function()
            WebSocketConnection:Send(JsonEncode(Payload))
        end)
        if not Ok then
            warn("[Rotellisense] Send error: " .. tostring(ErrorMessage))
        end
    end

    WebSocketConnection.OnMessage:Connect(function(Raw)
        local MessageType = ExtractType(Raw)

        if MessageType == "complete" then
            local RequestId = ExtractStringField(Raw, "requestId") or ""
            local Scope = ExtractStringField(Raw, "scope") or ""
            local ServiceName = ExtractStringField(Raw, "serviceName") or ""
            local Path = ExtractStringField(Raw, "path") or ""
            local Prefix = ExtractStringField(Raw, "prefix") or ""

            local Items = ComputeCompletions(Scope, ServiceName, Path, Prefix)
            Send({
                type = "complete_result",
                requestId = RequestId,
                items = Items
            })
        elseif MessageType == "script_search" then
            local RequestId = ExtractStringField(Raw, "requestId") or ""
            local Query = ExtractStringField(Raw, "query") or ""
            local Limit = ExtractNumberField(Raw, "limit") or MaxScriptResults
            local ScriptItems = SearchScripts(Query, Limit)

            Send({
                type = "script_search_result",
                requestId = RequestId,
                scriptItems = ScriptItems
            })
        elseif MessageType == "script_decompile" then
            local RequestId = ExtractStringField(Raw, "requestId") or ""
            local ScriptId = ExtractStringField(Raw, "scriptId") or ""
            local Source, ErrorMessage = DecompileScript(ScriptId)

            if Source then
                Send({
                    type = "decompile_result",
                    requestId = RequestId,
                    source = Source
                })
            else
                Send({
                    type = "error",
                    requestId = RequestId,
                    message = ErrorMessage or "Decompile failed"
                })
            end
        elseif MessageType == "index_scripts" then
            BuildScriptIndex()
            Send({
                type = "index_scripts_result",
                indexedCount = #ScriptRecords
            })
        end
    end)

    WebSocketConnection.OnClose:Connect(function()
        warn("[Rotellisense] Disconnected. Reconnecting in 3s...")
        task.wait(3)
        Connect()
    end)
end

BuildScriptIndex()
game.DescendantAdded:Connect(AddScriptToIndex)

Connect()
