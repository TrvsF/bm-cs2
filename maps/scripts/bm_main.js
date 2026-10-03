// src/bm_main.ts
import { Instance, CSInputs as CSInputs2, CSDamageTypes, CSWeaponType } from "cs_script/point_script";

// src/bm_classes.ts
import { CSInputs, CSGearSlot } from "cs_script/point_script";
var SoldierSettings = {
  Primary: "weapon_mp7",
  Secondary: "",
  Health: 150,
  SizeScale: 1.25,
  RocketDamage: 100,
  RocketRadius: 160,
  RocketSpeed: 1200
};
var DemoSettings = {
  Primary: "weapon_nova",
  Secondary: "",
  Health: 130,
  SizeScale: 1,
  DetonateKey: CSInputs.ATTACK2,
  MaxStickies: 8,
  ArmTime: 0.8,
  LaunchSpeed: 900,
  LaunchUp: 150,
  Radius: 160,
  Damage: 100,
  Knockback: 450
};
var MedicSettings = {
  Primary: "weapon_mp7",
  Secondary: "",
  Health: 100,
  SizeScale: 0.9,
  Range: 450,
  BreakRange: 540,
  HealPerSec: 24,
  OverhealMult: 1.5,
  OverhealDecayPerSec: 3.3,
  UberSecondsToFill: 40,
  UberDuration: 8
};
var DefaultHealth = 100;
var DefaultSizeScale = 1;
var StrippedGearSlots = [CSGearSlot.RIFLE, CSGearSlot.PISTOL, CSGearSlot.GRENADES];
function ApplyBody(Pawn, Health, SizeScale) {
  Pawn.SetMaxHealth(Health);
  Pawn.SetHealth(Health);
  Pawn.SetModelScale(SizeScale);
}
function RestoreDefaultBody(Pawn) {
  ApplyBody(Pawn, DefaultHealth, DefaultSizeScale);
}
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
var UPlayerClass = class {
  Settings;
  constructor(Settings) {
    this.Settings = Settings;
  }
  // Everything every class does on spawn. Subclasses add extras in OnLoadoutApplied.
  ApplyLoadout(Pawn) {
    StripGuns(Pawn);
    ApplyBody(Pawn, this.Settings.Health, this.Settings.SizeScale);
    const bHasSecondary = this.Settings.Secondary !== "" && this.Settings.Secondary !== this.Settings.Primary;
    if (bHasSecondary) {
      Pawn.GiveNamedItem(this.Settings.Secondary);
    }
    Pawn.GiveNamedItem(this.Settings.Primary, true);
    this.OnLoadoutApplied(Pawn);
  }
  // Override for class-specific setup. Runs after the shared loadout.
  OnLoadoutApplied(Pawn) {
  }
};
var USoldierClass = class extends UPlayerClass {
  constructor() {
    super(SoldierSettings);
  }
};
var UDemomanClass = class extends UPlayerClass {
  constructor() {
    super(DemoSettings);
  }
};
var UMedicClass = class extends UPlayerClass {
  constructor() {
    super(MedicSettings);
  }
  OnLoadoutApplied(Pawn) {
    const Knife = Pawn.FindWeaponBySlot(CSGearSlot.KNIFE);
    if (Knife) {
      Pawn.SwitchToWeapon(Knife);
    }
  }
};
var ClassDefinitions = {
  ["demo" /* Demoman */]: new UDemomanClass(),
  ["soldier" /* Solider */]: new USoldierClass(),
  ["medic" /* Medic */]: new UMedicClass()
};
function GiveLoadout(Pawn, PlayerClass) {
  ClassDefinitions[PlayerClass].ApplyLoadout(Pawn);
}

// src/bm_main.ts
var bDebug = true;
var TickInterval = 1 / 64;
var Gravity = 800;
var INDEX_NONE = -1;
var MaxPlayerSlots = 64;
var LogPrefix = "[BM]";
var StickyTemplateName = "sticky_template";
var ExplosionTemplateName = "boom_template";
var UpVector = { x: 0, y: 0, z: 1 };
var ChestOffset = { x: 0, y: 0, z: 40 };
var StickyLaunchOffset = { x: 0, y: 0, z: -8 };
var ExplosionOffset = { x: 0, y: 0, z: 6 };
var GroundedKnockbackLift = { x: 0, y: 0, z: 0.6 };
var BeamStartDrop = { x: 0, y: 0, z: 12 };
var TerroristColor = { r: 220, g: 60, b: 50 };
var CounterTerroristColor = { r: 70, g: 130, b: 230 };
var UnarmedStickyColor = { r: 120, g: 120, b: 120 };
var ExplosionDebugColor = { r: 255, g: 140, b: 0 };
var UberReadyColor = { r: 255, g: 255, b: 255 };
var ClassChatCommands = /* @__PURE__ */ new Map(
  [
    ["!demo", "demo" /* Demoman */],
    ["!medic", "medic" /* Medic */],
    ["!solider", "soldier" /* Solider */],
    ["!none", "none" /* None */]
  ]
);
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
  Instance.SetNextThink(Now + TickInterval);
  const DeltaTime = Math.min(0.1, Math.max(0, Now - GLastThinkTime)) || TickInterval;
  GLastThinkTime = Now;
  try {
    TickMatch(Now);
    TickTimers(Now);
    const HealedPawns = /* @__PURE__ */ new Set();
    const UberedPawns = /* @__PURE__ */ new Set();
    let HudLine = 0;
    ForEachLivePawn((Pawn, Slot) => {
      const PlayerClass = GClassBySlot.get(Slot);
      if (PlayerClass === "demo" /* Demoman */) {
        TickDemoman(Pawn, Slot, Now, DeltaTime);
      } else if (PlayerClass === "medic" /* Medic */) {
        TickMedic(Pawn, Slot, Now, DeltaTime, HealedPawns, UberedPawns, HudLine++);
      }
    });
    TickOverhealDecay(HealedPawns, DeltaTime);
    UpdateUberGlows(UberedPawns);
    GUberedPawns = UberedPawns;
  } catch (Exception) {
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
BeginPlay();
function HandlePlayerChat(Event) {
  const Player = Event.player;
  if (!Player) {
    return;
  }
  const Command = Event.text.trim().toLowerCase();
  const PlayerClass = ClassChatCommands.get(Command);
  if (PlayerClass === void 0) {
    return;
  }
  const Slot = Player.GetPlayerSlot();
  ClearPlayer(Slot);
  const Pawn = Player.GetPlayerPawn();
  if (PlayerClass === "none" /* None */) {
    GClassBySlot.delete(Slot);
    if (Pawn && Pawn.IsAlive()) {
      RestoreDefaultBody(Pawn);
    }
  } else {
    GClassBySlot.set(Slot, PlayerClass);
    if (Pawn && Pawn.IsAlive()) {
      GiveLoadout(Pawn, PlayerClass);
    }
  }
  const ClassLabel = PlayerClass === "none" /* None */ ? "normal" : PlayerClass;
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
  if (PlayerClass === void 0) {
    return;
  }
  SetTimer(0.1, () => {
    if (Pawn.IsValid() && Pawn.IsAlive()) {
      GiveLoadout(Pawn, PlayerClass);
    }
  });
}
function HandlePlayerKill(Event) {
  const Slot = GetPlayerSlot(Event.player);
  if (Slot !== INDEX_NONE) {
    ClearPlayer(Slot);
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
  if (!Pawn || Slot === INDEX_NONE || GClassBySlot.get(Slot) !== "demo" /* Demoman */ || !IsWeapon(Weapon, DemoSettings.Primary)) {
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
    Model: SpawnFromTemplate(StickyTemplateName, Start)
  };
  const State = GetPlayerState(Slot);
  State.Stickies.push(Sticky);
  if (!bDebug) {
    while (State.Stickies.length > DemoSettings.MaxStickies) {
      const Oldest = State.Stickies.shift();
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
  if (AttackerClass === "demo" /* Demoman */ && !bIsBlast && IsWeapon(Event.weapon, DemoSettings.Primary)) {
    return { abort: true };
  }
  if (AttackerClass === "medic" /* Medic */ && Event.weapon && Event.weapon.GetData().GetType() === CSWeaponType.KNIFE) {
    return { abort: true };
  }
  return;
}
var GClassBySlot = /* @__PURE__ */ new Map();
var GPlayerStates = /* @__PURE__ */ new Map();
var GPendingTimers = [];
var GUberedPawns = /* @__PURE__ */ new Set();
var GGlowingPawns = /* @__PURE__ */ new Set();
var GLastThinkTime = 0;
function GetPlayerState(Slot) {
  let State = GPlayerStates.get(Slot);
  if (!State) {
    State = {
      Stickies: [],
      bDetonateHeld: false,
      HealTarget: void 0,
      HealAccumulator: 0,
      DecayAccumulator: 0,
      UberCharge: 0,
      UberEndTime: 0
    };
    GPlayerStates.set(Slot, State);
  }
  return State;
}
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
  State.HealTarget = void 0;
  State.UberCharge = 0;
  State.UberEndTime = 0;
}
function StepSticky(Sticky, DeltaTime, Now) {
  if (Sticky.bStuck) {
    return true;
  }
  Sticky.Velocity = { x: Sticky.Velocity.x, y: Sticky.Velocity.y, z: Sticky.Velocity.z - Gravity * DeltaTime };
  const NextPosition = FVectorMath.Add(Sticky.Position, FVectorMath.Scale(Sticky.Velocity, DeltaTime));
  const IgnoredEntities = IsValid(Sticky.Model) ? [Sticky.Owner, Sticky.Model] : [Sticky.Owner];
  const Trace = Instance.TraceLine(
    {
      start: Sticky.Position,
      end: NextPosition,
      ignoreEntity: IgnoredEntities,
      ignorePlayers: true
    }
  );
  if (Trace.didHit) {
    Sticky.Position = FVectorMath.Add(Trace.end, FVectorMath.Scale(Trace.normal, 2));
    Sticky.bStuck = true;
  } else {
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
    Victim.TakeDamage(
      {
        damage: CalculatedDmg,
        damageTypes: CSDamageTypes.BLAST,
        attacker: Attacker,
        inflictor: Attacker
      }
    );
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
  return void 0;
}
function TickMedic(Pawn, Slot, Now, DeltaTime, HealedPawns, UberedPawns, HudLine) {
  const State = GetPlayerState(Slot);
  const ActiveWeapon = Pawn.GetActiveWeapon();
  const bHoldingMedigun = !!ActiveWeapon && ActiveWeapon.GetData().GetType() === CSWeaponType.KNIFE;
  const bFiring = bHoldingMedigun && Pawn.IsInputPressed(CSInputs2.ATTACK);
  let Target = bFiring ? State.HealTarget : void 0;
  if (Target && !IsHealTargetValid(Pawn, Target)) {
    Target = void 0;
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
      const ChargeRate = 100 / MedicSettings.UberSecondsToFill * (Health < MaxHealth ? 1 : 0.5);
      State.UberCharge = Math.min(100, State.UberCharge + ChargeRate * DeltaTime);
    }
    Instance.DebugLine(
      {
        start: FVectorMath.Subtract(Pawn.GetEyePosition(), BeamStartDrop),
        end: GetChestPosition(Target),
        duration: TickInterval * 2,
        color: GetTeamColor(Pawn)
      }
    );
  }
  if (Now >= State.UberEndTime && State.UberCharge >= 100 && bHoldingMedigun && Pawn.IsInputPressed(CSInputs2.ATTACK2)) {
    State.UberEndTime = Now + MedicSettings.UberDuration;
  }
  const bUberActive = Now < State.UberEndTime;
  if (bUberActive) {
    State.UberCharge = 100 * (State.UberEndTime - Now) / MedicSettings.UberDuration;
    UberedPawns.add(Pawn);
    if (Target) {
      UberedPawns.add(Target);
    }
  }
  const Controller = Pawn.GetPlayerController();
  const MedicName = Controller ? Controller.GetPlayerName() : "medic";
  const ActiveText = bUberActive ? "  ACTIVE" : "";
  const PatientText = Target ? `  | patient ${Target.GetHealth()} HP` : "";
  Instance.DebugScreenText(
    {
      text: `${MedicName}  \xDCBER ${Math.floor(State.UberCharge)}%${ActiveText}${PatientText}`,
      x: 40,
      y: 220 + HudLine * 18,
      duration: TickInterval * 2,
      color: State.UberCharge >= 100 ? UberReadyColor : GetTeamColor(Pawn)
    }
  );
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
    } else {
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
var FVectorMath = class {
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
    const Pitch = Rotation.pitch * Math.PI / 180;
    const Yaw = Rotation.yaw * Math.PI / 180;
    return { x: Math.cos(Pitch) * Math.cos(Yaw), y: Math.cos(Pitch) * Math.sin(Yaw), z: -Math.sin(Pitch) };
  }
};
function IsValid(Ent) {
  return Ent !== void 0 && Ent.IsValid();
}
function IsPlayerPawn(Ent) {
  return Ent !== void 0 && "GetPlayerController" in Ent && typeof Ent.GetPlayerController === "function" && "IsInputPressed" in Ent && typeof Ent.IsInputPressed === "function";
}
function IsPointTemplate(Ent) {
  return Ent !== void 0 && "ForceSpawn" in Ent && typeof Ent.ForceSpawn === "function";
}
function GetChestPosition(Pawn) {
  return FVectorMath.Add(Pawn.GetAbsOrigin(), ChestOffset);
}
function GetTeamColor(Ent) {
  return Ent.GetTeamNumber() === 2 /* Terrorist */ ? TerroristColor : CounterTerroristColor;
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
  return Data !== void 0 && Data.GetName() === Name;
}
function SpawnFromTemplate(TemplateName, Position) {
  const Template = Instance.FindEntityByName(TemplateName);
  if (!IsPointTemplate(Template)) {
    return void 0;
  }
  const Spawned = Template.ForceSpawn(Position);
  return Spawned ? Spawned[0] : void 0;
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
