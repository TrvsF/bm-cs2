import { Instance, CSInputs, CSDamageTypes, CSWeaponType, CSGearSlot } from "cs_script/point_script";
const bDebug = true;
const TickInterval = 1 / 64;
const Gravity = 800;
var EPlayerClass;
(function (EPlayerClass) {
    EPlayerClass["None"] = "none";
    EPlayerClass["Demoman"] = "demo";
    EPlayerClass["Solider"] = "soldier";
    EPlayerClass["Medic"] = "medic";
})(EPlayerClass || (EPlayerClass = {}));
var ETeam;
(function (ETeam) {
    ETeam[ETeam["Unassigned"] = 0] = "Unassigned";
    ETeam[ETeam["Spectator"] = 1] = "Spectator";
    ETeam[ETeam["Terrorist"] = 2] = "Terrorist";
    ETeam[ETeam["CounterTerrorist"] = 3] = "CounterTerrorist";
})(ETeam || (ETeam = {}));
// Data ////////////////////////////////////////////////////////////////////////////////////////////
const SoldierSettings = {
    Primary: "weapon_nova",
    Secondary: "",
    Health: 150,
    SizeScale: 1.25,
    RocketDamage: 100,
    RocketRadius: 160,
    RocketSpeed: 1200,
};
const DemoSettings = {
    Primary: "weapon_nova",
    Secondary: "",
    Health: 130,
    SizeScale: 1.0,
    DetonateKey: CSInputs.ATTACK2,
    MaxStickies: 8,
    ArmTime: 0.8,
    LaunchSpeed: 900,
    LaunchUp: 150,
    Radius: 160,
    Damage: 100,
    Knockback: 450,
};
const MedicSettings = {
    Primary: "weapon_mp7",
    Secondary: "",
    Health: 150,
    SizeScale: 0.9,
    Range: 450,
    BreakRange: 540,
    HealPerSec: 24,
    OverhealMult: 1.5,
    OverhealDecayPerSec: 3.3,
    UberSecondsToFill: 40,
    UberDuration: 8,
};
const INDEX_NONE = -1;
const MaxPlayerSlots = 64;
const LogPrefix = "[BM]";
const StickyTemplateName = "sticky_template";
const ExplosionTemplateName = "boom_template";
const UpVector = { x: 0, y: 0, z: 1 };
const ChestOffset = { x: 0, y: 0, z: 40 };
const StickyLaunchOffset = { x: 0, y: 0, z: -8 };
const ExplosionOffset = { x: 0, y: 0, z: 6 };
const GroundedKnockbackLift = { x: 0, y: 0, z: 0.6 };
const BeamStartDrop = { x: 0, y: 0, z: 12 };
const TerroristColor = { r: 220, g: 60, b: 50 };
const CounterTerroristColor = { r: 70, g: 130, b: 230 };
const UnarmedStickyColor = { r: 120, g: 120, b: 120 };
const ExplosionDebugColor = { r: 255, g: 140, b: 0 };
const UberReadyColor = { r: 255, g: 255, b: 255 };
const StrippedGearSlots = [CSGearSlot.RIFLE, CSGearSlot.PISTOL, CSGearSlot.GRENADES];
const ClassChatCommands = new Map([
    ["!demo", EPlayerClass.Demoman],
    ["!medic", EPlayerClass.Medic],
    ["!none", EPlayerClass.None],
]);
// Main ///////////////////////////////////////////////////////////////////////////////////////////
function TickTimers(Now) {
    for (let Index = GPendingTimers.length - 1; Index >= 0; Index--) {
        const Timer = GPendingTimers[Index];
        if (Timer && Timer.FireTime <= Now) {
            GPendingTimers.splice(Index, 1);
            Timer.Callback();
        }
    }
}
function Tick() {
    const Now = Instance.GetGameTime();
    Instance.SetNextThink(Now + TickInterval); // schedule first so an error can't stop the loop
    const DeltaTime = Math.min(0.1, Math.max(0, Now - GLastThinkTime)) || TickInterval;
    GLastThinkTime = Now;
    try {
        TickMatch(Now);
        TickTimers(Now);
        const HealedPawns = new Set();
        const UberedPawns = new Set();
        let HudLine = 0;
        ForEachLivePawn((Pawn, Slot) => {
            const PlayerClass = GClassBySlot.get(Slot);
            if (PlayerClass === EPlayerClass.Demoman) {
                TickDemoman(Pawn, Slot, Now, DeltaTime);
            }
            else if (PlayerClass === EPlayerClass.Medic) {
                TickMedic(Pawn, Slot, Now, DeltaTime, HealedPawns, UberedPawns, HudLine++);
            }
        });
        TickOverhealDecay(HealedPawns, DeltaTime);
        UpdateUberGlows(UberedPawns);
        GUberedPawns = UberedPawns;
    }
    catch (Exception) {
        Instance.Msg(`${LogPrefix} error: ${String(Exception)}`);
    }
}
function BeginPlay() {
    Instance.OnPlayerChat(HandlePlayerChat);
    Instance.OnPlayerReset(HandlePlayerReset);
    Instance.OnPlayerKill(HandlePlayerKill);
    Instance.OnPlayerDisconnect(HandlePlayerDisconnect);
    Instance.OnRoundStart(HandleRoundStart);
    Instance.OnGunFire(HandleGunFire);
    Instance.OnModifyPlayerDamage(HandleModifyPlayerDamage);
    Instance.SetThink(Tick);
    Instance.SetNextThink(Instance.GetGameTime());
    Instance.Msg(`${LogPrefix} loaded${bDebug ? " (DEBUG on)" : ""}. Type !demo or !medic in chat.`);
}
BeginPlay(); // !
// Handle /////////////////////////////////////////////////////////////////////////////////////////
// TODO : this Handle block should have as little logic as possible ///////////////////////////////
function HandlePlayerChat(Event) {
    const Player = Event.player;
    if (!Player) {
        return;
    }
    // A Map lookup, so only these exact commands match
    const Command = Event.text.trim().toLowerCase();
    const PlayerClass = ClassChatCommands.get(Command);
    if (PlayerClass === undefined) {
        return;
    }
    const Slot = Player.GetPlayerSlot();
    ClearPlayer(Slot);
    if (PlayerClass === EPlayerClass.None) {
        GClassBySlot.delete(Slot);
    }
    else {
        GClassBySlot.set(Slot, PlayerClass);
        const Pawn = Player.GetPlayerPawn();
        if (Pawn && Pawn.IsAlive()) {
            GiveLoadout(Pawn, PlayerClass);
        }
    }
    const ClassLabel = PlayerClass === EPlayerClass.None ? "normal" : PlayerClass;
    Instance.Msg(`${LogPrefix} ${Player.GetPlayerName()} -> ${ClassLabel}`);
}
function HandlePlayerReset(Event) {
    const Pawn = Event.player;
    const Slot = GetPlayerSlot(Pawn);
    if (Slot === INDEX_NONE) {
        return;
    }
    ClearPlayer(Slot);
    const PlayerClass = GClassBySlot.get(Slot);
    if (PlayerClass === undefined) {
        return;
    }
    // Small delay so the default spawn loadout doesn't overwrite ours
    SetTimer(0.1, () => {
        if (Pawn.IsValid() && Pawn.IsAlive()) {
            GiveLoadout(Pawn, PlayerClass);
        }
    });
}
function HandlePlayerKill(Event) {
    const Slot = GetPlayerSlot(Event.player);
    if (Slot !== INDEX_NONE) {
        ClearPlayer(Slot); // stickies vanish and über resets on death, like TF2
    }
}
function HandlePlayerDisconnect(Event) {
    ClearPlayer(Event.playerSlot);
    GClassBySlot.delete(Event.playerSlot);
    GPlayerStates.delete(Event.playerSlot);
}
function HandleRoundStart() {
    for (const Slot of GPlayerStates.keys()) {
        ClearPlayer(Slot);
    }
    ApplyMatchSettings();
    Instance.Msg(`${LogPrefix} match settings applied`);
}
function HandleGunFire(Event) {
    const Weapon = Event.weapon;
    const Pawn = Weapon.GetOwner();
    const Slot = GetPlayerSlot(Pawn);
    if (!Pawn || Slot === INDEX_NONE || GClassBySlot.get(Slot) !== EPlayerClass.Demoman || !IsWeapon(Weapon, DemoSettings.Primary)) {
        return;
    }
    const Now = Instance.GetGameTime();
    const Direction = FVectorMath.GetForwardVector(Pawn.GetEyeAngles());
    const Start = FVectorMath.Add(Pawn.GetEyePosition(), StickyLaunchOffset);
    const LaunchVelocity = FVectorMath.Add(FVectorMath.Scale(Direction, DemoSettings.LaunchSpeed), { x: 0, y: 0, z: DemoSettings.LaunchUp });
    const Sticky = {
        Owner: Pawn,
        Position: Start,
        Velocity: LaunchVelocity,
        bStuck: false,
        ArmedAt: Now + DemoSettings.ArmTime,
        SpawnedAt: Now,
        Model: SpawnFromTemplate(StickyTemplateName, Start),
    };
    const State = GetPlayerState(Slot);
    State.Stickies.push(Sticky);
    if (!bDebug) {
        while (State.Stickies.length > DemoSettings.MaxStickies) {
            const Oldest = State.Stickies.shift(); // oldest fizzles
            if (Oldest) {
                DestroySticky(Oldest);
            }
        }
    }
}
function HandleModifyPlayerDamage(Event) {
    if (GUberedPawns.has(Event.player)) {
        return { abort: true };
    }
    const AttackerSlot = GetPlayerSlot(Event.attacker);
    if (AttackerSlot === INDEX_NONE) {
        return;
    }
    const AttackerClass = GClassBySlot.get(AttackerSlot);
    const bIsBlast = (Event.damageTypes & CSDamageTypes.BLAST) !== 0;
    if (AttackerClass === EPlayerClass.Demoman && !bIsBlast && IsWeapon(Event.weapon, DemoSettings.Primary)) {
        return { abort: true };
    }
    if (AttackerClass === EPlayerClass.Medic && Event.weapon && Event.weapon.GetData().GetType() === CSWeaponType.KNIFE) {
        return { abort: true };
    }
    return;
}
// Globals ////////////////////////////////////////////////////////////////////////////////////////
const GClassBySlot = new Map();
const GPlayerStates = new Map();
const GPendingTimers = [];
let GUberedPawns = new Set();
let GGlowingPawns = new Set();
let GLastThinkTime = 0;
function GetPlayerState(Slot) {
    let State = GPlayerStates.get(Slot);
    if (!State) {
        State =
            {
                Stickies: [],
                bDetonateHeld: false,
                HealTarget: undefined,
                HealAccumulator: 0,
                DecayAccumulator: 0,
                UberCharge: 0,
                UberEndTime: 0,
            };
        GPlayerStates.set(Slot, State);
    }
    return State;
}
// Match //////////////////////////////////////////////////////////////////////////////////////////
function ApplyMatchSettings() {
    const Commands = [];
    if (bDebug) {
        Commands.push("mp_do_warmup_period 0", "mp_warmuptime 0", "mp_freezetime 0");
        Commands.push("mp_roundtime 60", "mp_roundtime_defuse 60", "mp_roundtime_hostage 60", "mp_timelimit 0", "mp_maxrounds 0");
        Commands.push("mp_ignore_round_win_conditions 1", "mp_respawn_on_death_t 1", "mp_respawn_on_death_ct 1");
        Commands.push("sv_infinite_ammo 1");
        Commands.push("bot_quota_mode fill", "bot_quota 8", "bot_join_team any", "bot_stop 1");
    }
    for (const Command of Commands) {
        Instance.ServerCommand(Command);
    }
}
function TickMatch(Now) {
    if (bDebug && Instance.IsWarmupPeriod()) {
        Instance.ServerCommand("mp_warmup_end");
    }
}
// Class //////////////////////////////////////////////////////////////////////////////////////////
function StripGuns(Pawn) {
    for (const GearSlot of StrippedGearSlots) {
        for (let Attempt = 0; Attempt < 6; Attempt++) {
            const Weapon = Pawn.FindWeaponBySlot(GearSlot);
            if (!Weapon) {
                break;
            }
            Pawn.DestroyWeapon(Weapon);
        }
    }
}
function GiveLoadout(Pawn, PlayerClass) {
    StripGuns(Pawn);
    switch (PlayerClass) {
        case EPlayerClass.Demoman:
            {
                Pawn.GiveNamedItem(DemoSettings.Primary, true);
                break;
            }
        case EPlayerClass.Medic:
            {
                Pawn.GiveNamedItem(MedicSettings.Primary);
                const Knife = Pawn.FindWeaponBySlot(CSGearSlot.KNIFE);
                if (Knife) {
                    Pawn.SwitchToWeapon(Knife);
                }
                break;
            }
        case EPlayerClass.Solider:
            {
                break;
            }
        default:
            {
                const Unhandled = PlayerClass;
                Instance.Msg(`${LogPrefix} no loadout for class ${String(Unhandled)}`);
                break;
            }
    }
}
function DestroySticky(Sticky) {
    if (IsValid(Sticky.Model)) {
        Sticky.Model.Remove();
    }
}
function ClearPlayer(Slot) {
    const State = GPlayerStates.get(Slot);
    if (!State) {
        return;
    }
    for (const Sticky of State.Stickies) {
        DestroySticky(Sticky);
    }
    State.Stickies = [];
    State.HealTarget = undefined;
    State.UberCharge = 0;
    State.UberEndTime = 0;
}
// Demo //////////////////////////////////////////////////////////////////////////////////////////
function StepSticky(Sticky, DeltaTime, Now) {
    if (Sticky.bStuck) {
        return true;
    }
    Sticky.Velocity = { x: Sticky.Velocity.x, y: Sticky.Velocity.y, z: Sticky.Velocity.z - Gravity * DeltaTime };
    const NextPosition = FVectorMath.Add(Sticky.Position, FVectorMath.Scale(Sticky.Velocity, DeltaTime));
    const IgnoredEntities = IsValid(Sticky.Model) ? [Sticky.Owner, Sticky.Model] : [Sticky.Owner];
    const Trace = Instance.TraceLine({
        start: Sticky.Position,
        end: NextPosition,
        ignoreEntity: IgnoredEntities,
        ignorePlayers: true,
    });
    if (Trace.didHit) {
        Sticky.Position = FVectorMath.Add(Trace.end, FVectorMath.Scale(Trace.normal, 2)); // sit just off the surface
        Sticky.bStuck = true;
    }
    else {
        Sticky.Position = NextPosition;
    }
    if (IsValid(Sticky.Model)) {
        Sticky.Model.Teleport({ position: Sticky.Position });
    }
    return true;
}
function Explode(Position, Attacker) {
    const Origin = FVectorMath.Add(Position, ExplosionOffset);
    if (!SpawnFromTemplate(ExplosionTemplateName, Origin)) {
        Instance.DebugSphere({ center: Origin, radius: DemoSettings.Radius, duration: 0.3, color: ExplosionDebugColor });
    }
    if (!Attacker.IsValid()) {
        return;
    }
    ForEachLivePawn((Victim) => {
        const Target = GetChestPosition(Victim);
        const Offset = FVectorMath.Subtract(Target, Origin);
        const Distance = FVectorMath.Size(Offset);
        if (Distance > DemoSettings.Radius) {
            return;
        }
        const Trace = Instance.TraceLine({ start: Origin, end: Target, ignorePlayers: true });
        if (Trace.didHit && !Trace.startedInSolid) {
            return;
        }
        const bIsSelf = Victim === Attacker;
        if (!bIsSelf && Victim.GetTeamNumber() === Attacker.GetTeamNumber()) {
            return;
        }
        const Falloff = 1 - 0.5 * (Distance / DemoSettings.Radius);
        let CalculatedDmg = DemoSettings.Damage * Falloff;
        if (bIsSelf) {
            CalculatedDmg *= 0.33;
        }
        // do knockback 
        const IsCrouched = Victim.IsDucking() || Victim.IsDucked();
        let Direction = Distance > 1 ? FVectorMath.GetSafeNormal(Offset) : UpVector;
        if (Victim.GetGroundEntity()) {
            Direction = FVectorMath.GetSafeNormal(FVectorMath.Add(Direction, GroundedKnockbackLift));
        }
        const CrouchFactor = IsCrouched ? 62 : 82;
        let KBStrength = DemoSettings.Knockback;
        if (!Victim.GetGroundEntity() && bIsSelf) {
            KBStrength *= 1.33;
        }
        const CalculatedKb = CalculatedDmg * (KBStrength / CrouchFactor);
        Victim.Teleport({ velocity: FVectorMath.Add(Victim.GetAbsVelocity(), FVectorMath.Scale(Direction, CalculatedKb)) });
        Victim.TakeDamage({
            damage: CalculatedDmg,
            damageTypes: CSDamageTypes.BLAST,
            attacker: Attacker,
            inflictor: Attacker,
        });
        Instance.Msg(`${LogPrefix} Damaged ${Victim.GetPlayerController()?.GetPlayerName()} : ${CalculatedDmg}d : ${CalculatedKb}k (${Direction.x}, ${Direction.y}, ${Direction.z}) : ${Falloff}f`);
    });
}
function TickDemoman(Pawn, Slot, Now, DeltaTime) {
    const State = GetPlayerState(Slot);
    State.Stickies = State.Stickies.filter((Sticky) => {
        const bKeep = StepSticky(Sticky, DeltaTime, Now);
        if (!bKeep) {
            DestroySticky(Sticky);
        }
        return bKeep;
    });
    for (const Sticky of State.Stickies) {
        if (!Sticky.Model) {
            const Color = Now >= Sticky.ArmedAt ? GetTeamColor(Pawn) : UnarmedStickyColor;
            Instance.DebugSphere({ center: Sticky.Position, radius: 4, duration: TickInterval * 2, color: Color });
        }
    }
    const bDown = Pawn.IsInputPressed(DemoSettings.DetonateKey);
    const bPressed = bDown && !State.bDetonateHeld;
    State.bDetonateHeld = bDown;
    if (!bPressed) {
        return;
    }
    const StillArming = [];
    for (const Sticky of State.Stickies) {
        if (Now < Sticky.ArmedAt) {
            StillArming.push(Sticky);
            continue;
        }
        DestroySticky(Sticky);
        Explode(Sticky.Position, Pawn);
    }
    State.Stickies = StillArming;
}
// Medic //////////////////////////////////////////////////////////////////////////////////////////
function IsHealTargetValid(Medic, Target) {
    if (!Target.IsValid() || !Target.IsAlive() || Target.GetTeamNumber() !== Medic.GetTeamNumber()) {
        return false;
    }
    const EyePosition = Medic.GetEyePosition();
    const TargetChest = GetChestPosition(Target);
    if (FVectorMath.Size(FVectorMath.Subtract(TargetChest, EyePosition)) > MedicSettings.BreakRange) {
        return false;
    }
    return !Instance.TraceLine({ start: EyePosition, end: TargetChest, ignorePlayers: true }).didHit;
}
function AcquireHealTarget(Medic) {
    const EyePosition = Medic.GetEyePosition();
    const Forward = FVectorMath.GetForwardVector(Medic.GetEyeAngles());
    const End = FVectorMath.Add(EyePosition, FVectorMath.Scale(Forward, MedicSettings.Range));
    const HitEntity = Instance.TraceSphere({ start: EyePosition, end: End, radius: 12, ignoreEntity: Medic }).hitEntity;
    if (IsPlayerPawn(HitEntity) && HitEntity.IsAlive() && HitEntity.GetTeamNumber() === Medic.GetTeamNumber()) {
        return HitEntity;
    }
    return undefined;
}
function TickMedic(Pawn, Slot, Now, DeltaTime, HealedPawns, UberedPawns, HudLine) {
    const State = GetPlayerState(Slot);
    const ActiveWeapon = Pawn.GetActiveWeapon();
    const bHoldingMedigun = !!ActiveWeapon && ActiveWeapon.GetData().GetType() === CSWeaponType.KNIFE;
    const bFiring = bHoldingMedigun && Pawn.IsInputPressed(CSInputs.ATTACK);
    let Target = bFiring ? State.HealTarget : undefined;
    if (Target && !IsHealTargetValid(Pawn, Target)) {
        Target = undefined;
    }
    if (bFiring && !Target) {
        Target = AcquireHealTarget(Pawn);
    }
    State.HealTarget = Target;
    if (Target) {
        HealedPawns.add(Target);
        const MaxHealth = Target.GetMaxHealth();
        const OverhealCap = Math.floor(MaxHealth * MedicSettings.OverhealMult);
        const Health = Target.GetHealth();
        if (Health < OverhealCap) {
            State.HealAccumulator += MedicSettings.HealPerSec * DeltaTime;
            const WholeHealth = Math.floor(State.HealAccumulator);
            if (WholeHealth > 0) {
                Target.SetHealth(Math.min(OverhealCap, Health + WholeHealth));
                State.HealAccumulator -= WholeHealth;
            }
        }
        if (Now >= State.UberEndTime) {
            const ChargeRate = (100 / MedicSettings.UberSecondsToFill) * (Health < MaxHealth ? 1 : 0.5); // slower on topped-up patients
            State.UberCharge = Math.min(100, State.UberCharge + ChargeRate * DeltaTime);
        }
        // Placeholder beam (tools mode only). Swap for an env_beam for real servers.
        Instance.DebugLine({
            start: FVectorMath.Subtract(Pawn.GetEyePosition(), BeamStartDrop),
            end: GetChestPosition(Target),
            duration: TickInterval * 2,
            color: GetTeamColor(Pawn),
        });
    }
    if (Now >= State.UberEndTime && State.UberCharge >= 100 && bHoldingMedigun && Pawn.IsInputPressed(CSInputs.ATTACK2)) {
        State.UberEndTime = Now + MedicSettings.UberDuration;
    }
    const bUberActive = Now < State.UberEndTime;
    if (bUberActive) {
        State.UberCharge = (100 * (State.UberEndTime - Now)) / MedicSettings.UberDuration;
        UberedPawns.add(Pawn);
        if (Target) {
            UberedPawns.add(Target);
        }
    }
    // Placeholder meter (tools mode only)
    const Controller = Pawn.GetPlayerController();
    const MedicName = Controller ? Controller.GetPlayerName() : "medic";
    const ActiveText = bUberActive ? "  ACTIVE" : "";
    const PatientText = Target ? `  | patient ${Target.GetHealth()} HP` : "";
    Instance.DebugScreenText({
        text: `${MedicName}  ÜBER ${Math.floor(State.UberCharge)}%${ActiveText}${PatientText}`,
        x: 40,
        y: 220 + HudLine * 18,
        duration: TickInterval * 2,
        color: State.UberCharge >= 100 ? UberReadyColor : GetTeamColor(Pawn),
    });
}
function TickOverhealDecay(HealedPawns, DeltaTime) {
    ForEachLivePawn((Pawn, Slot) => {
        const State = GetPlayerState(Slot);
        const MaxHealth = Pawn.GetMaxHealth();
        const Health = Pawn.GetHealth();
        if (Health > MaxHealth && !HealedPawns.has(Pawn)) {
            State.DecayAccumulator += MedicSettings.OverhealDecayPerSec * DeltaTime;
            const WholeDecay = Math.floor(State.DecayAccumulator);
            if (WholeDecay > 0) {
                Pawn.SetHealth(Math.max(MaxHealth, Health - WholeDecay));
                State.DecayAccumulator -= WholeDecay;
            }
        }
        else {
            State.DecayAccumulator = 0;
        }
    });
}
function UpdateUberGlows(UberedPawns) {
    for (const Pawn of GGlowingPawns) {
        if (!UberedPawns.has(Pawn) && Pawn.IsValid()) {
            Pawn.Unglow();
        }
    }
    for (const Pawn of UberedPawns) {
        if (!GGlowingPawns.has(Pawn)) {
            Pawn.Glow(GetTeamColor(Pawn));
        }
    }
    GGlowingPawns = new Set(UberedPawns);
}
// Util ///////////////////////////////////////////////////////////////////////////////////////////
class FVectorMath {
    static Add(A, B) {
        return { x: A.x + B.x, y: A.y + B.y, z: A.z + B.z };
    }
    static Subtract(A, B) {
        return { x: A.x - B.x, y: A.y - B.y, z: A.z - B.z };
    }
    static Scale(V, Scalar) {
        return { x: V.x * Scalar, y: V.y * Scalar, z: V.z * Scalar };
    }
    static Size(V) {
        return Math.hypot(V.x, V.y, V.z);
    }
    static GetSafeNormal(V) {
        const Length = Math.hypot(V.x, V.y, V.z) || 1;
        return { x: V.x / Length, y: V.y / Length, z: V.z / Length };
    }
    static GetForwardVector(Rotation) {
        const Pitch = (Rotation.pitch * Math.PI) / 180;
        const Yaw = (Rotation.yaw * Math.PI) / 180;
        return { x: Math.cos(Pitch) * Math.cos(Yaw), y: Math.cos(Pitch) * Math.sin(Yaw), z: -Math.sin(Pitch) };
    }
}
function IsValid(Ent) {
    return Ent !== undefined && Ent.IsValid();
}
function IsPlayerPawn(Ent) {
    return Ent !== undefined
        && "GetPlayerController" in Ent && typeof Ent.GetPlayerController === "function"
        && "IsInputPressed" in Ent && typeof Ent.IsInputPressed === "function";
}
function IsPointTemplate(Ent) {
    return Ent !== undefined && "ForceSpawn" in Ent && typeof Ent.ForceSpawn === "function";
}
function GetChestPosition(Pawn) {
    return FVectorMath.Add(Pawn.GetAbsOrigin(), ChestOffset);
}
function GetTeamColor(Ent) {
    return Ent.GetTeamNumber() === ETeam.Terrorist ? TerroristColor : CounterTerroristColor;
}
function GetPlayerSlot(Ent) {
    if (!IsPlayerPawn(Ent)) {
        return INDEX_NONE;
    }
    const Controller = Ent.GetPlayerController();
    return Controller ? Controller.GetPlayerSlot() : INDEX_NONE;
}
function IsWeapon(Weapon, Name) {
    if (!Weapon) {
        return false;
    }
    if (Weapon.GetClassName() === Name) {
        return true;
    }
    const Data = Weapon.GetData();
    return Data !== undefined && Data.GetName() === Name;
}
function SpawnFromTemplate(TemplateName, Position) {
    const Template = Instance.FindEntityByName(TemplateName);
    if (!IsPointTemplate(Template)) {
        return undefined;
    }
    const Spawned = Template.ForceSpawn(Position);
    return Spawned ? Spawned[0] : undefined;
}
function SetTimer(Delay, Callback) {
    GPendingTimers.push({ FireTime: Instance.GetGameTime() + Delay, Callback });
}
function ForEachLivePawn(Visitor) {
    for (let Slot = 0; Slot < MaxPlayerSlots; Slot++) {
        const Controller = Instance.GetPlayerController(Slot);
        if (!Controller) {
            continue;
        }
        const Pawn = Controller.GetPlayerPawn();
        if (IsValid(Pawn) && Pawn.IsAlive()) {
            Visitor(Pawn, Slot);
        }
    }
}
