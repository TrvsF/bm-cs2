// src/bm_main.ts
import { Instance as Instance2, CSInputs as CSInputs2, CSDamageTypes as CSDamageTypes2, CSWeaponType as CSWeaponType2 } from "cs_script/point_script";

// src/bm_classes.ts
import { Instance, CSInputs, CSGearSlot, CSDamageTypes, CSWeaponType } from "cs_script/point_script";
var TF2HitscanFalloff = { RampUp: 1.5, FallOff: 0.5, OptimalDistance: 512 };
var TF2RocketFalloff = { RampUp: 1.25, FallOff: 0.5, OptimalDistance: 512 };
var TF2StickyFalloff = { RampUp: 1.1, FallOff: 0.9, OptimalDistance: 512 };
var SoldierSettings = {
  Primary: "weapon_scar20",
  Secondary: "",
  Melee: "weapon_knife",
  Health: 150,
  SizeScale: 1.25,
  RocketDamage: 80,
  RocketRadius: 160,
  RocketSpeed: 1200,
  RocketKnockback: 400,
  RocketLifetime: 10,
  RocketFalloff: TF2RocketFalloff
};
var DemoSettings = {
  Primary: "weapon_nova",
  Secondary: "weapon_glock",
  Melee: "",
  Health: 130,
  SizeScale: 1,
  DetonateKey: CSInputs.ATTACK2,
  MaxStickies: 6,
  ArmTime: 0.8,
  LaunchSpeed: 900,
  LaunchUp: 150,
  Radius: 160,
  Damage: 90,
  Knockback: 600,
  StickyFalloff: TF2StickyFalloff,
  StickyFalloffTime: 5
};
var MedicSettings = {
  Primary: "weapon_mp7",
  Secondary: "",
  Melee: "weapon_knife",
  Health: 150,
  SizeScale: 0.9,
  BulletFalloff: TF2HitscanFalloff,
  Range: 450,
  BreakRange: 540,
  HealPerSec: 24,
  OverhealMult: 1.5,
  OverhealDecayPerSec: 3.3,
  UberSecondsToFill: 40,
  UberDuration: 8
};
var StickyTemplateName = "sticky_template";
var RocketTemplateName = "rocket_template";
var DefaultHealth = 100;
var DefaultSizeScale = 1;
var StrippedGearSlots = [CSGearSlot.RIFLE, CSGearSlot.PISTOL, CSGearSlot.KNIFE, CSGearSlot.GRENADES];
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
  ApplyLoadout(Pawn) {
    StripGuns(Pawn);
    ApplyBody(Pawn, this.Settings.Health, this.Settings.SizeScale);
    if (this.Settings.Melee !== "") {
      Pawn.GiveNamedItem(this.Settings.Melee);
    }
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
  // Called when someone playing this class fires their primary
  OnPrimaryFire(Pawn, Slot, Now) {
  }
  // Called every tick, whether or not anyone is playing this class
  TickWorld(Now, DeltaTime) {
  }
  OnRoundStart() {
  }
  // Override to change or block damage dealt by this class
  ModifyOutgoingDamage(Event) {
    return;
  }
  // True for the primary's own bullets, as opposed to explosions it causes
  IsPrimaryBulletDamage(Event) {
    const bIsBlast = (Event.damageTypes & CSDamageTypes.BLAST) !== 0;
    return !bIsBlast && IsWeapon(Event.weapon, this.Settings.Primary);
  }
};
var USoldierClass = class extends UPlayerClass {
  Rockets = [];
  constructor() {
    super(SoldierSettings);
  }
  OnPrimaryFire(Pawn, Slot, Now) {
    const Rocket = LaunchProjectile(Pawn, this.Settings.RocketSpeed, 0, 0, RocketTemplateName);
    this.Rockets.push(Rocket);
  }
  TickWorld(Now, DeltaTime) {
    this.Rockets = this.Rockets.filter((Rocket) => {
      return this.StepRocket(Rocket, Now, DeltaTime);
    });
  }
  OnRoundStart() {
    for (const Rocket of this.Rockets) {
      DestroyProjectile(Rocket);
    }
    this.Rockets = [];
  }
  ModifyOutgoingDamage(Event) {
    if (this.IsPrimaryBulletDamage(Event)) {
      return { abort: true };
    }
    return;
  }
  StepRocket(Rocket, Now, DeltaTime) {
    if (!Rocket.Owner.IsValid() || Now - Rocket.SpawnedAt > this.Settings.RocketLifetime) {
      DestroyProjectile(Rocket);
      return false;
    }
    if (MoveProjectile(Rocket, DeltaTime, true)) {
      DestroyProjectile(Rocket);
      Explode(Rocket.Position, Rocket.Owner, this.Settings.RocketRadius, this.Settings.RocketDamage, this.Settings.RocketKnockback, this.Settings.RocketFalloff);
      return false;
    }
    if (!Rocket.Model) {
      Instance.DebugSphere({ center: Rocket.Position, radius: 3, duration: TickInterval * 2, color: GetTeamColor(Rocket.Owner) });
    }
    return true;
  }
};
var UDemomanClass = class extends UPlayerClass {
  constructor() {
    super(DemoSettings);
  }
  OnPrimaryFire(Pawn, Slot, Now) {
    const Sticky = {
      ...LaunchProjectile(Pawn, this.Settings.LaunchSpeed, this.Settings.LaunchUp, 1, StickyTemplateName),
      bStuck: false,
      ArmedAt: Now + this.Settings.ArmTime
    };
    const State = GetPlayerState(Slot);
    State.Stickies.push(Sticky);
    if (!bDebug) {
      while (State.Stickies.length > this.Settings.MaxStickies) {
        const Oldest = State.Stickies.shift();
        if (Oldest) {
          DestroyProjectile(Oldest);
        }
      }
    }
  }
  ModifyOutgoingDamage(Event) {
    if (this.IsPrimaryBulletDamage(Event)) {
      return { abort: true };
    }
    return;
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
  ModifyOutgoingDamage(Event) {
    if (Event.weapon && Event.weapon.GetData().GetType() === CSWeaponType.KNIFE) {
      return { abort: true };
    }
    return ApplyBulletFalloff(Event, this.Settings.BulletFalloff);
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
var ExplosionTemplateName = "boom_template";
var ScorchTemplateName = "scorch_template";
var BloodTemplateName = "blood_template";
var MaxDecals = 48;
var ScorchSearchDistance = 16;
var BloodSplatterDistance = 128;
var BotMarkerModes = /* @__PURE__ */ new Map(
  [
    ["bot_still", 0 /* Still */],
    ["bot_run", 1 /* Run */],
    ["bot_jump", 2 /* Jump */]
  ]
);
var BotRunSpeed = 250;
var BotJumpSpeed = 301;
var BotSpawnSettleTime = 0.1;
var BotTurnCheckDistance = 40;
var BotLedgeCheckDepth = 64;
var DamageHudName = "damage_hud";
var DamageLabelId = "DamageNumber";
var DamageBatchWindow = 0.6;
var DamageShowTime = 0.85;
var UpVector = { x: 0, y: 0, z: 1 };
var ZeroVector = { x: 0, y: 0, z: 0 };
var ChestOffset = { x: 0, y: 0, z: 40 };
var ProjectileLaunchOffset = { x: 0, y: 0, z: -8 };
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
  const Now = Instance2.GetGameTime();
  Instance2.SetNextThink(Now + TickInterval);
  const DeltaTime = Math.min(0.1, Math.max(0, Now - GLastThinkTime)) || TickInterval;
  GLastThinkTime = Now;
  try {
    TickMatch(Now);
    TickTimers(Now);
    for (const Definition of Object.values(ClassDefinitions)) {
      Definition.TickWorld(Now, DeltaTime);
    }
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
    TickBots(Now);
  } catch (Exception) {
    Instance2.Msg(`${LogPrefix} error: ${String(Exception)}`);
  }
}
function BeginPlay() {
  Instance2.OnPlayerChat(HandlePlayerChat);
  Instance2.OnPlayerReset(HandlePlayerReset);
  Instance2.OnPlayerKill(HandlePlayerKill);
  Instance2.OnPlayerDisconnect(HandlePlayerDisconnect);
  Instance2.OnRoundStart(HandleRoundStart);
  Instance2.OnGunFire(HandleGunFire);
  Instance2.OnPlayerDamage(HandlePlayerDamage);
  Instance2.OnModifyPlayerDamage(HandleModifyPlayerDamage);
  Instance2.SetThink(Tick);
  Instance2.SetNextThink(Instance2.GetGameTime());
  Instance2.Msg(`${LogPrefix} loaded${bDebug ? " (DEBUG on)" : ""}`);
}
BeginPlay();
function HandlePlayerChat(Event) {
  const Player = Event.player;
  if (!Player) {
    return;
  }
  const Command = Event.text.trim().toLowerCase();
  if (bDebug && Command === "!hudtest") {
    ShowDamageNumber(Player.GetPlayerSlot(), 123);
    return;
  }
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
  Instance2.Msg(`${LogPrefix} ${Player.GetPlayerName()} -> ${ClassLabel}`);
}
function HandlePlayerReset(Event) {
  const Pawn = Event.player;
  const Slot = GetPlayerSlot(Pawn);
  if (Slot === INDEX_NONE) {
    return;
  }
  ClearPlayer(Slot);
  ResetBotMode(Slot);
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
  ReleaseBotMarker(Event.playerSlot);
  GBotReadyAt.delete(Event.playerSlot);
  ResetDamageNumbers(Event.playerSlot);
  GClassBySlot.delete(Event.playerSlot);
  GPlayerStates.delete(Event.playerSlot);
}
function HandleRoundStart() {
  for (const Slot of GPlayerStates.keys()) {
    ClearPlayer(Slot);
  }
  for (const Definition of Object.values(ClassDefinitions)) {
    Definition.OnRoundStart();
  }
  ClearDecals();
  ApplyMatchSettings();
  Instance2.Msg(`${LogPrefix} match settings applied`);
}
function HandleGunFire(Event) {
  const Weapon = Event.weapon;
  const Pawn = Weapon.GetOwner();
  const Slot = GetPlayerSlot(Pawn);
  const PlayerClass = GClassBySlot.get(Slot);
  if (!Pawn || PlayerClass === void 0) {
    return;
  }
  const Definition = ClassDefinitions[PlayerClass];
  if (IsWeapon(Weapon, Definition.Settings.Primary)) {
    Definition.OnPrimaryFire(Pawn, Slot, Instance2.GetGameTime());
  }
}
function HandlePlayerDamage(Event) {
  const AttackerSlot = GetPlayerSlot(Event.attacker);
  if (AttackerSlot === INDEX_NONE || Event.attacker === Event.player) {
    return;
  }
  ShowDamageNumber(AttackerSlot, Event.damage);
}
function HandleModifyPlayerDamage(Event) {
  if (GUberedPawns.has(Event.player)) {
    return { abort: true };
  }
  if ((Event.damageTypes & CSDamageTypes2.FALL) !== 0 && GClassBySlot.has(GetPlayerSlot(Event.player))) {
    return { abort: true };
  }
  const AttackerSlot = GetPlayerSlot(Event.attacker);
  const AttackerClass = GClassBySlot.get(AttackerSlot);
  if (AttackerClass === void 0) {
    return;
  }
  return ClassDefinitions[AttackerClass].ModifyOutgoingDamage(Event);
}
var GClassBySlot = /* @__PURE__ */ new Map();
var GPlayerStates = /* @__PURE__ */ new Map();
var GPendingTimers = [];
var GUberedPawns = /* @__PURE__ */ new Set();
var GGlowingPawns = /* @__PURE__ */ new Set();
var GLastThinkTime = 0;
var GbWarnedNoDamageHud = false;
var GDecals = [];
var GBotAssignments = /* @__PURE__ */ new Map();
var GBotReadyAt = /* @__PURE__ */ new Map();
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
      UberEndTime: 0,
      DamageTotal: 0,
      LastDamageTime: 0,
      bDamagePopA: false
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
    Instance2.ServerCommand(Command);
  }
}
function TickMatch(Now) {
  if (bDebug && Instance2.IsWarmupPeriod()) {
    Instance2.ServerCommand("mp_warmup_end");
  }
}
function ClearPlayer(Slot) {
  const State = GPlayerStates.get(Slot);
  if (!State) {
    return;
  }
  for (const Sticky of State.Stickies) {
    DestroyProjectile(Sticky);
  }
  State.Stickies = [];
  State.HealTarget = void 0;
  State.UberCharge = 0;
  State.UberEndTime = 0;
}
function LaunchProjectile(Owner, Speed, UpSpeed, GravityScale, TemplateName) {
  const Direction = FVectorMath.GetForwardVector(Owner.GetEyeAngles());
  const Start = FVectorMath.Add(Owner.GetEyePosition(), ProjectileLaunchOffset);
  const Projectile = {
    Owner,
    Position: Start,
    Velocity: FVectorMath.Add(FVectorMath.Scale(Direction, Speed), { x: 0, y: 0, z: UpSpeed }),
    GravityScale,
    SpawnedAt: Instance2.GetGameTime(),
    Model: SpawnFromTemplate(TemplateName, Start)
  };
  return Projectile;
}
function MoveProjectile(Projectile, DeltaTime, bHitPlayers) {
  const Velocity = Projectile.Velocity;
  Projectile.Velocity = { x: Velocity.x, y: Velocity.y, z: Velocity.z - Gravity * Projectile.GravityScale * DeltaTime };
  const NextPosition = FVectorMath.Add(Projectile.Position, FVectorMath.Scale(Projectile.Velocity, DeltaTime));
  const IgnoredEntities = IsValid(Projectile.Model) ? [Projectile.Owner, Projectile.Model] : [Projectile.Owner];
  const Trace = Instance2.TraceLine(
    {
      start: Projectile.Position,
      end: NextPosition,
      ignoreEntity: IgnoredEntities,
      ignorePlayers: !bHitPlayers
    }
  );
  if (Trace.didHit) {
    Projectile.Position = FVectorMath.Add(Trace.end, FVectorMath.Scale(Trace.normal, 2));
  } else {
    Projectile.Position = NextPosition;
  }
  if (IsValid(Projectile.Model)) {
    Projectile.Model.Teleport({ position: Projectile.Position });
  }
  return Trace.didHit ? Trace : void 0;
}
function DestroyProjectile(Projectile) {
  if (IsValid(Projectile.Model)) {
    Projectile.Model.Remove();
  }
}
function Explode(Position, Attacker, Radius, Damage, Knockback, RangeFalloff) {
  const Origin = FVectorMath.Add(Position, ExplosionOffset);
  if (!SpawnFromTemplate(ExplosionTemplateName, Origin)) {
    Instance2.DebugSphere({ center: Origin, radius: Radius, duration: 0.3, color: ExplosionDebugColor });
  }
  SpawnScorchMark(Position);
  if (!Attacker.IsValid()) {
    return;
  }
  ForEachLivePawn((Victim) => {
    const Target = GetChestPosition(Victim);
    const Offset = FVectorMath.Subtract(Target, Origin);
    const Distance = FVectorMath.Size(Offset);
    if (Distance > Radius) {
      return;
    }
    const Trace = Instance2.TraceLine({ start: Origin, end: Target, ignorePlayers: true });
    if (Trace.didHit && !Trace.startedInSolid) {
      return;
    }
    const bIsSelf = Victim === Attacker;
    if (!bIsSelf && Victim.GetTeamNumber() === Attacker.GetTeamNumber()) {
      return;
    }
    const Falloff = 1 - 0.5 * (Distance / Radius);
    const RangeScale = bIsSelf ? 1 : GetRangeDamageScale(Attacker, Victim, RangeFalloff);
    let CalculatedDmg = Damage * Falloff * RangeScale;
    const IsCrouched = Victim.IsDucking() || Victim.IsDucked();
    let Direction = Distance > 1 ? FVectorMath.GetSafeNormal(Offset) : UpVector;
    if (Victim.GetGroundEntity()) {
      Direction = FVectorMath.GetSafeNormal(FVectorMath.Add(Direction, GroundedKnockbackLift));
    }
    const CrouchFactor = IsCrouched ? 62 : 82;
    let KBStrength = Knockback;
    if (!Victim.GetGroundEntity() && bIsSelf) {
      KBStrength *= 1.33;
    }
    const CalculatedKb = CalculatedDmg * (KBStrength / CrouchFactor);
    Victim.Teleport({ velocity: FVectorMath.Add(Victim.GetAbsVelocity(), FVectorMath.Scale(Direction, CalculatedKb)) });
    if (bIsSelf) {
      CalculatedDmg *= 0.33;
    }
    const DamageDealt = Victim.TakeDamage(
      {
        damage: CalculatedDmg,
        damageTypes: CSDamageTypes2.BLAST,
        attacker: Attacker,
        inflictor: Attacker
      }
    );
    if (!bIsSelf && DamageDealt > 0) {
      SpawnBloodSplatter(Origin, Victim);
    }
    Instance2.Msg(`${LogPrefix} ${Attacker.GetPlayerController()?.GetPlayerName()} Damaged ${Victim.GetPlayerController()?.GetPlayerName()} : ${CalculatedDmg}d : ${CalculatedKb}k (${Direction.x}, ${Direction.y}, ${Direction.z}) : ${Falloff}f : ${RangeScale.toFixed(2)}r`);
  });
}
function GetDistanceDamageScale(Distance, Falloff) {
  const Closeness = Math.min(1, Math.max(0, 1 - Distance / (2 * Falloff.OptimalDistance)));
  const Curve = Closeness * Closeness * (3 - 2 * Closeness);
  if (Curve >= 0.5) {
    return 1 + (Falloff.RampUp - 1) * (2 * Curve - 1);
  }
  return 1 - (1 - Falloff.FallOff) * (1 - 2 * Curve);
}
function GetRangeDamageScale(Attacker, Victim, Falloff) {
  if (!Falloff) {
    return 1;
  }
  const Distance = FVectorMath.Size(FVectorMath.Subtract(GetChestPosition(Victim), GetChestPosition(Attacker)));
  return GetDistanceDamageScale(Distance, Falloff);
}
function ApplyBulletFalloff(Event, Falloff) {
  const Attacker = Event.attacker;
  const Weapon = Event.weapon;
  const bIsBullet = (Event.damageTypes & (CSDamageTypes2.BULLET | CSDamageTypes2.BUCKSHOT)) !== 0;
  if (!Falloff || !Weapon || !bIsBullet || !IsPlayerPawn(Attacker) || Attacker === Event.player) {
    return;
  }
  if (Weapon.GetData().GetType() === CSWeaponType2.KNIFE) {
    return;
  }
  const BulletTravel = FVectorMath.Size(FVectorMath.Subtract(GetChestPosition(Event.player), Attacker.GetEyePosition()));
  const CsRangeScale = Math.pow(Weapon.GetData().GetRangeModifier(), BulletTravel / 500);
  const RangeScale = GetRangeDamageScale(Attacker, Event.player, Falloff);
  const Damage = Math.max(1, Math.round(Event.damage / CsRangeScale * RangeScale));
  if (bDebug) {
    Instance2.Msg(`${LogPrefix} bullet falloff: ${Math.round(BulletTravel)}u x${RangeScale.toFixed(2)} (${Math.round(Event.damage)} -> ${Damage})`);
  }
  return { damage: Damage };
}
function StepSticky(Sticky, DeltaTime, Now) {
  if (!Sticky.bStuck && MoveProjectile(Sticky, DeltaTime, false)) {
    Sticky.bStuck = true;
  }
  return true;
}
function TickDemoman(Pawn, Slot, Now, DeltaTime) {
  const State = GetPlayerState(Slot);
  State.Stickies = State.Stickies.filter((Sticky) => {
    const bKeep = StepSticky(Sticky, DeltaTime, Now);
    if (!bKeep) {
      DestroyProjectile(Sticky);
    }
    return bKeep;
  });
  for (const Sticky of State.Stickies) {
    if (!Sticky.Model) {
      const Color = Now >= Sticky.ArmedAt ? GetTeamColor(Pawn) : UnarmedStickyColor;
      Instance2.DebugSphere({ center: Sticky.Position, radius: 4, duration: TickInterval * 2, color: Color });
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
    DestroyProjectile(Sticky);
    const bYoungSticky = Now - Sticky.SpawnedAt < DemoSettings.StickyFalloffTime;
    const RangeFalloff = bYoungSticky ? DemoSettings.StickyFalloff : void 0;
    Explode(Sticky.Position, Pawn, DemoSettings.Radius, DemoSettings.Damage, DemoSettings.Knockback, RangeFalloff);
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
  return !Instance2.TraceLine({ start: EyePosition, end: TargetChest, ignorePlayers: true }).didHit;
}
function AcquireHealTarget(Medic) {
  const EyePosition = Medic.GetEyePosition();
  const Forward = FVectorMath.GetForwardVector(Medic.GetEyeAngles());
  const End = FVectorMath.Add(EyePosition, FVectorMath.Scale(Forward, MedicSettings.Range));
  const HitEntity = Instance2.TraceSphere({ start: EyePosition, end: End, radius: 12, ignoreEntity: Medic }).hitEntity;
  if (IsPlayerPawn(HitEntity) && HitEntity.IsAlive() && HitEntity.GetTeamNumber() === Medic.GetTeamNumber()) {
    return HitEntity;
  }
  return void 0;
}
function TickMedic(Pawn, Slot, Now, DeltaTime, HealedPawns, UberedPawns, HudLine) {
  const State = GetPlayerState(Slot);
  const ActiveWeapon = Pawn.GetActiveWeapon();
  const bHoldingMedigun = !!ActiveWeapon && ActiveWeapon.GetData().GetType() === CSWeaponType2.KNIFE;
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
    Instance2.DebugLine(
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
  Instance2.DebugScreenText(
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
function TickBots(Now) {
  const FreeMarkers = FindFreeBotMarkers();
  ForEachLivePawn((Pawn, Slot) => {
    const Controller = Pawn.GetPlayerController();
    if (!Controller || !Controller.IsBot()) {
      return;
    }
    const ReadyAt = GBotReadyAt.get(Slot);
    if (ReadyAt !== void 0 && Now < ReadyAt) {
      return;
    }
    let Assignment = GBotAssignments.get(Slot);
    if (!Assignment) {
      Assignment = ClaimBotMarker(Slot, FreeMarkers);
      if (!Assignment) {
        return;
      }
    }
    if (!Assignment.bPlaced) {
      PlaceBotOnMarker(Pawn, Assignment);
    }
    DriveBot(Pawn, Assignment);
  });
}
function FindFreeBotMarkers() {
  const Claimed = /* @__PURE__ */ new Set();
  for (const Assignment of GBotAssignments.values()) {
    Claimed.add(Assignment.Marker);
  }
  const FreeMarkers = /* @__PURE__ */ new Map();
  for (const [MarkerName, Mode] of BotMarkerModes) {
    for (const Marker of Instance2.FindEntitiesByName(MarkerName)) {
      if (Marker.IsValid() && !Claimed.has(Marker)) {
        FreeMarkers.set(Marker, Mode);
      }
    }
  }
  return FreeMarkers;
}
function ClaimBotMarker(Slot, FreeMarkers) {
  for (const [Marker, Mode] of FreeMarkers) {
    FreeMarkers.delete(Marker);
    const Assignment = { Marker, Mode, Yaw: 0, bPlaced: false };
    GBotAssignments.set(Slot, Assignment);
    return Assignment;
  }
  return void 0;
}
function PlaceBotOnMarker(Pawn, Assignment) {
  if (!Assignment.Marker.IsValid()) {
    return;
  }
  Assignment.Yaw = Assignment.Marker.GetAbsAngles().yaw;
  Assignment.bPlaced = true;
  Pawn.Teleport({ position: Assignment.Marker.GetAbsOrigin(), angles: { pitch: 0, yaw: Assignment.Yaw, roll: 0 }, velocity: ZeroVector });
  Pawn.SetEyeAngles({ pitch: 0, yaw: Assignment.Yaw, roll: 0 });
  Pawn.SetHealth(1e3);
}
function DriveBot(Pawn, Assignment) {
  if (Assignment.Mode === 0 /* Still */ || !Pawn.GetGroundEntity()) {
    return;
  }
  if (Assignment.Mode === 2 /* Jump */) {
    Pawn.Teleport({ velocity: { x: 0, y: 0, z: BotJumpSpeed } });
    return;
  }
  if (IsBotPathBlocked(Pawn, Assignment.Yaw)) {
    Assignment.Yaw = (Assignment.Yaw + 180) % 360;
    Pawn.Teleport({ angles: { pitch: 0, yaw: Assignment.Yaw, roll: 0 } });
    Pawn.SetEyeAngles({ pitch: 0, yaw: Assignment.Yaw, roll: 0 });
  }
  const Forward = FVectorMath.GetForwardVector({ pitch: 0, yaw: Assignment.Yaw, roll: 0 });
  Pawn.Teleport({ velocity: { x: Forward.x * BotRunSpeed, y: Forward.y * BotRunSpeed, z: Pawn.GetAbsVelocity().z } });
}
function IsBotPathBlocked(Pawn, Yaw) {
  const Forward = FVectorMath.GetForwardVector({ pitch: 0, yaw: Yaw, roll: 0 });
  const Knee = FVectorMath.Add(Pawn.GetAbsOrigin(), { x: 0, y: 0, z: 24 });
  const Ahead = FVectorMath.Add(Knee, FVectorMath.Scale(Forward, BotTurnCheckDistance));
  const Wall = Instance2.TraceLine({ start: Knee, end: Ahead, ignorePlayers: true });
  if (Wall.didHit) {
    return true;
  }
  const Floor = Instance2.TraceLine(
    {
      start: Ahead,
      end: FVectorMath.Add(Ahead, { x: 0, y: 0, z: -(24 + BotLedgeCheckDepth) }),
      ignorePlayers: true
    }
  );
  return !Floor.didHit;
}
function ResetBotMode(Slot) {
  const Assignment = GBotAssignments.get(Slot);
  if (Assignment) {
    Assignment.bPlaced = false;
  }
  GBotReadyAt.set(Slot, Instance2.GetGameTime() + BotSpawnSettleTime);
}
function ReleaseBotMarker(Slot) {
  GBotAssignments.delete(Slot);
}
function SpawnScorchMark(Position) {
  const Surface = FindNearbySurface(Position, ScorchSearchDistance);
  if (Surface) {
    SpawnDecal(ScorchTemplateName, Surface.end, Surface.normal);
  }
}
function SpawnBloodSplatter(ExplosionOrigin, Victim) {
  const Chest = GetChestPosition(Victim);
  const Away = FVectorMath.GetSafeNormal(FVectorMath.Subtract(Chest, ExplosionOrigin));
  const Behind = Instance2.TraceLine(
    {
      start: Chest,
      end: FVectorMath.Add(Chest, FVectorMath.Scale(Away, BloodSplatterDistance)),
      ignorePlayers: true
    }
  );
  if (Behind.didHit && !Behind.startedInSolid) {
    SpawnDecal(BloodTemplateName, Behind.end, Behind.normal);
    return;
  }
  const Below = Instance2.TraceLine(
    {
      start: Chest,
      end: FVectorMath.Add(Chest, FVectorMath.Scale(UpVector, -BloodSplatterDistance)),
      ignorePlayers: true
    }
  );
  if (Below.didHit && !Below.startedInSolid) {
    SpawnDecal(BloodTemplateName, Below.end, Below.normal);
  }
}
function SpawnDecal(TemplateName, Position, SurfaceNormal) {
  const Template = Instance2.FindEntityByName(TemplateName);
  if (!IsPointTemplate(Template)) {
    return;
  }
  const Rotation = FVectorMath.GetRotation(FVectorMath.Scale(SurfaceNormal, -1), Math.random() * 360);
  const Spawned = Template.ForceSpawn(Position, Rotation);
  if (!Spawned || Spawned.length === 0) {
    return;
  }
  GDecals.push(Spawned);
  while (GDecals.length > MaxDecals) {
    const Oldest = GDecals.shift();
    if (Oldest) {
      RemoveEntities(Oldest);
    }
  }
}
function ClearDecals() {
  for (const Decal of GDecals) {
    RemoveEntities(Decal);
  }
  GDecals = [];
}
function FindNearbySurface(Position, MaxDistance) {
  const Directions = [
    { x: 0, y: 0, z: -1 },
    { x: 0, y: 0, z: 1 },
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 }
  ];
  let Closest = void 0;
  for (const Direction of Directions) {
    const Trace = Instance2.TraceLine(
      {
        start: Position,
        end: FVectorMath.Add(Position, FVectorMath.Scale(Direction, MaxDistance)),
        ignorePlayers: true
      }
    );
    if (Trace.didHit && !Trace.startedInSolid && (!Closest || Trace.fraction < Closest.fraction)) {
      Closest = Trace;
    }
  }
  return Closest;
}
function RemoveEntities(Entities) {
  for (const Ent of Entities) {
    if (Ent.IsValid()) {
      Ent.Remove();
    }
  }
}
function ShowDamageNumber(Slot, Damage) {
  const Hud = FindDamageHud();
  if (!Hud || Damage <= 0) {
    return;
  }
  const State = GetPlayerState(Slot);
  const Now = Instance2.GetGameTime();
  if (Now - State.LastDamageTime > DamageBatchWindow) {
    State.DamageTotal = 0;
  }
  State.DamageTotal += Damage;
  State.LastDamageTime = Now;
  State.bDamagePopA = !State.bDamagePopA;
  Hud.SetDialogVariableStringForPlayer(Slot, DamageLabelId, "damage", `-${Math.round(State.DamageTotal)}`);
  SetTimer(DamageShowTime, () => {
    const LaterHud = FindDamageHud();
    if (LaterHud && Instance2.GetGameTime() - State.LastDamageTime >= DamageShowTime - 0.01) {
      LaterHud.SetDialogVariableStringForPlayer(Slot, DamageLabelId, "damage", "");
    }
  });
}
function ResetDamageNumbers(Slot) {
  const Hud = FindDamageHud();
  if (Hud) {
    Hud.ResetForPlayer(Slot);
  }
}
function FindDamageHud() {
  const Hud = Instance2.FindEntityByName(DamageHudName);
  if (IsCustomHudLayout(Hud)) {
    return Hud;
  }
  if (!GbWarnedNoDamageHud) {
    GbWarnedNoDamageHud = true;
    const Problem = Hud ? "exists but isn't a custom_hud_layout" : "wasn't found";
    Instance2.Msg(`${LogPrefix} damage numbers: an entity named "${DamageHudName}" ${Problem}. Check the custom_hud_layout in Hammer, then do a full map build.`);
  }
  return void 0;
}
var FVectorMath = class _FVectorMath {
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
  // The rotation whose forward vector points along Direction (the inverse of GetForwardVector)
  static GetRotation(Direction, Roll = 0) {
    const Normal = _FVectorMath.GetSafeNormal(Direction);
    const Pitch = -Math.asin(Math.max(-1, Math.min(1, Normal.z))) * 180 / Math.PI;
    const Yaw = Math.atan2(Normal.y, Normal.x) * 180 / Math.PI;
    return { pitch: Pitch, yaw: Yaw, roll: Roll };
  }
};
function IsValid(Ent) {
  return Ent !== void 0 && Ent.IsValid();
}
function IsPlayerPawn(Ent) {
  return Ent !== void 0 && "GetPlayerController" in Ent && typeof Ent.GetPlayerController === "function" && "IsInputPressed" in Ent && typeof Ent.IsInputPressed === "function";
}
function IsCustomHudLayout(Ent) {
  return Ent !== void 0 && "SetDialogVariableStringForPlayer" in Ent && typeof Ent.SetDialogVariableStringForPlayer === "function";
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
  const Template = Instance2.FindEntityByName(TemplateName);
  if (!IsPointTemplate(Template)) {
    return void 0;
  }
  const Spawned = Template.ForceSpawn(Position);
  return Spawned ? Spawned[0] : void 0;
}
function SetTimer(Delay, Callback) {
  GPendingTimers.push({ FireTime: Instance2.GetGameTime() + Delay, Callback });
}
function ForEachLivePawn(Visitor) {
  for (let Slot = 0; Slot < MaxPlayerSlots; Slot++) {
    const Controller = Instance2.GetPlayerController(Slot);
    if (!Controller) {
      continue;
    }
    const Pawn = Controller.GetPlayerPawn();
    if (IsValid(Pawn) && Pawn.IsAlive()) {
      Visitor(Pawn, Slot);
    }
  }
}
export {
  ApplyBulletFalloff,
  DestroyProjectile,
  Explode,
  GetDistanceDamageScale,
  GetPlayerState,
  GetTeamColor,
  IsWeapon,
  LaunchProjectile,
  MoveProjectile,
  TickInterval,
  bDebug
};
