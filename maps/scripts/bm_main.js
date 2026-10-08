// src/bm_main.ts
import { Instance as Instance10, CSDamageTypes as CSDamageTypes3, CSGearSlot as CSGearSlot2 } from "cs_script/point_script";

// src/bm_core.ts
import { Instance } from "cs_script/point_script";
var bDebug = true;
var bFriendlyFire = true;
var TickInterval = 1 / 64;
var INDEX_NONE = -1;
var LogPrefix = "[BM]";
var MaxPlayerSlots = 64;
var UpVector = { x: 0, y: 0, z: 1 };
var ZeroVector = { x: 0, y: 0, z: 0 };
var ChestOffset = { x: 0, y: 0, z: 40 };
var TerroristColor = { r: 220, g: 60, b: 50 };
var CounterTerroristColor = { r: 70, g: 130, b: 230 };
var GPendingTimers = [];
function SetTimer(Delay, Callback) {
  GPendingTimers.push({ FireTime: Instance.GetGameTime() + Delay, Callback });
}
function TickTimers(Now) {
  for (let Index = GPendingTimers.length - 1; Index >= 0; Index--) {
    const Timer = GPendingTimers[Index];
    if (Timer && Timer.FireTime <= Now) {
      GPendingTimers.splice(Index, 1);
      Timer.Callback();
    }
  }
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
var FRotationMath = class _FRotationMath {
  static FromRotator(Rotation) {
    const Pitch = Rotation.pitch * Math.PI / 180;
    const Yaw = Rotation.yaw * Math.PI / 180;
    const Roll = Rotation.roll * Math.PI / 180;
    const SP = Math.sin(Pitch);
    const CP = Math.cos(Pitch);
    const SY = Math.sin(Yaw);
    const CY = Math.cos(Yaw);
    const SR = Math.sin(Roll);
    const CR = Math.cos(Roll);
    const Result = {
      Forward: { x: CP * CY, y: CP * SY, z: -SP },
      Left: { x: SP * SR * CY - CR * SY, y: SP * SR * SY + CR * CY, z: SR * CP },
      Up: { x: SP * CR * CY + SR * SY, y: SP * CR * SY - SR * CY, z: CR * CP }
    };
    return Result;
  }
  static ToRotator(Matrix) {
    const Forward = Matrix.Forward;
    const FlatLength = Math.hypot(Forward.x, Forward.y);
    const Pitch = Math.atan2(-Forward.z, FlatLength);
    let Yaw = 0;
    let Roll = 0;
    if (FlatLength > 1e-3) {
      Yaw = Math.atan2(Forward.y, Forward.x);
      Roll = Math.atan2(Matrix.Left.z, Matrix.Up.z);
    } else {
      Yaw = Math.atan2(-Matrix.Left.x, Matrix.Left.y);
    }
    return { pitch: Pitch * 180 / Math.PI, yaw: Yaw * 180 / Math.PI, roll: Roll * 180 / Math.PI };
  }
  static RotateVector(Matrix, V) {
    const Result = {
      x: Matrix.Forward.x * V.x + Matrix.Left.x * V.y + Matrix.Up.x * V.z,
      y: Matrix.Forward.y * V.x + Matrix.Left.y * V.y + Matrix.Up.y * V.z,
      z: Matrix.Forward.z * V.x + Matrix.Left.z * V.y + Matrix.Up.z * V.z
    };
    return Result;
  }
  static Multiply(A, B) {
    const Result = {
      Forward: _FRotationMath.RotateVector(A, B.Forward),
      Left: _FRotationMath.RotateVector(A, B.Left),
      Up: _FRotationMath.RotateVector(A, B.Up)
    };
    return Result;
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
function SpawnTemplateEntities(TemplateName, Position, Rotation) {
  const Template = Instance.FindEntityByName(TemplateName);
  if (!IsPointTemplate(Template)) {
    return [];
  }
  return Template.ForceSpawn(Position, Rotation) ?? [];
}
function IsModelEntity(Ent) {
  return "SetModelScale" in Ent && typeof Ent.SetModelScale === "function";
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

// src/bm_classes.ts
import { Instance as Instance5, CSInputs as CSInputs2, CSGearSlot, CSDamageTypes as CSDamageTypes2, CSDamageFlags, CSWeaponType as CSWeaponType2, CSHitGroup } from "cs_script/point_script";

// src/bm_combat.ts
import { Instance as Instance3, CSDamageTypes, CSWeaponType } from "cs_script/point_script";

// src/bm_effects.ts
import { Instance as Instance2 } from "cs_script/point_script";
var ScorchTemplateName = "scorch_template";
var BloodTemplateName = "blood_template";
var MaxDecals = 48;
var ScorchSearchDistance = 16;
var BloodSplatterDistance = 128;
var GDecals = [];
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
function SpawnTemporaryTemplate(TemplateName, Position, Lifetime) {
  const Template = Instance2.FindEntityByName(TemplateName);
  if (!IsPointTemplate(Template)) {
    return void 0;
  }
  const Spawned = Template.ForceSpawn(Position);
  if (Spawned && Spawned.length > 0) {
    SetTimer(Lifetime, () => {
      RemoveEntities(Spawned);
    });
  }
  return Spawned;
}
function SpawnBeam(TemplateName, EndMarkerName, Start, End, Lifetime, FallbackColor) {
  const Template = Instance2.FindEntityByName(TemplateName);
  if (!IsPointTemplate(Template)) {
    Instance2.DebugLine({ start: Start, end: End, duration: Lifetime, color: FallbackColor });
    return;
  }
  const Spawned = Template.ForceSpawn(Start, FVectorMath.GetRotation(FVectorMath.Subtract(End, Start)));
  if (!Spawned || Spawned.length === 0) {
    return;
  }
  for (const Ent of Spawned) {
    if (Ent.GetEntityName().startsWith(EndMarkerName)) {
      Ent.Teleport({ position: End });
    }
  }
  SetTimer(Lifetime, () => {
    RemoveEntities(Spawned);
  });
}
function ClearDecals() {
  for (const Decal of GDecals) {
    RemoveEntities(Decal);
  }
  GDecals = [];
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

// src/bm_combat.ts
var Gravity = 800;
var ExplosionTemplateName = "boom_template";
var ExplosionFxLifetime = 5;
var ProjectileLaunchOffset = { x: 0, y: 0, z: -8 };
var ExplosionOffset = { x: 0, y: 0, z: 6 };
var GroundedKnockbackLift = { x: 0, y: 0, z: 0.6 };
var ExplosionDebugColor = { r: 255, g: 140, b: 0 };
var MaxHitscanTraces = 8;
var GroundTraceLift = { x: 0, y: 0, z: 2 };
function LaunchProjectile(Owner, Speed, UpSpeed, GravityScale, TemplateName) {
  const Direction = FVectorMath.GetForwardVector(Owner.GetEyeAngles());
  const Start = FVectorMath.Add(Owner.GetEyePosition(), ProjectileLaunchOffset);
  const Velocity = FVectorMath.Add(FVectorMath.Scale(Direction, Speed), { x: 0, y: 0, z: UpSpeed });
  const Projectile = {
    Owner,
    Position: Start,
    Velocity,
    GravityScale,
    SpawnedAt: Instance3.GetGameTime(),
    Models: SpawnProjectileModels(TemplateName, Start)
  };
  PlaceProjectileModels(Projectile, true);
  return Projectile;
}
function MoveProjectile(Projectile, DeltaTime, bHitPlayers) {
  const Velocity = Projectile.Velocity;
  Projectile.Velocity = { x: Velocity.x, y: Velocity.y, z: Velocity.z - Gravity * Projectile.GravityScale * DeltaTime };
  const NextPosition = FVectorMath.Add(Projectile.Position, FVectorMath.Scale(Projectile.Velocity, DeltaTime));
  const IgnoredEntities = [Projectile.Owner];
  for (const Model of Projectile.Models) {
    if (Model.Ent.IsValid()) {
      IgnoredEntities.push(Model.Ent);
    }
  }
  const Trace = Instance3.TraceLine(
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
  PlaceProjectileModels(Projectile, false);
  return Trace.didHit ? Trace : void 0;
}
function DestroyProjectile(Projectile) {
  for (const Model of Projectile.Models) {
    if (Model.Ent.IsValid()) {
      Model.Ent.Remove();
    }
  }
  Projectile.Models = [];
}
function TintProjectile(Projectile, Color) {
  for (const Model of Projectile.Models) {
    if (Model.Ent.IsValid() && IsModelEntity(Model.Ent)) {
      Model.Ent.SetColor(Color);
    }
  }
}
function SpawnProjectileModels(TemplateName, Position) {
  const Models = [];
  for (const Ent of SpawnTemplateEntities(TemplateName, Position, void 0)) {
    Models.push({ Ent, LocalRotation: FRotationMath.FromRotator(Ent.GetAbsAngles()) });
  }
  return Models;
}
function PlaceProjectileModels(Projectile, bTeleport) {
  const Flight = FRotationMath.FromRotator(FVectorMath.GetRotation(Projectile.Velocity));
  for (const Model of Projectile.Models) {
    if (!Model.Ent.IsValid() || Model.Ent.GetParent() !== void 0) {
      continue;
    }
    const Angles = FRotationMath.ToRotator(FRotationMath.Multiply(Flight, Model.LocalRotation));
    if (bTeleport) {
      Model.Ent.Teleport({ position: Projectile.Position, angles: Angles });
    } else {
      Model.Ent.Move({ position: Projectile.Position, angles: Angles });
    }
  }
}
function Explode(Position, Attacker, Radius, Damage, Knockback, RangeFalloff) {
  const Origin = FVectorMath.Add(Position, ExplosionOffset);
  if (!SpawnTemporaryTemplate(ExplosionTemplateName, Origin, ExplosionFxLifetime)) {
    Instance3.DebugSphere({ center: Origin, radius: Radius, duration: 0.3, color: ExplosionDebugColor });
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
    const Trace = Instance3.TraceLine({ start: Origin, end: Target, ignorePlayers: true });
    if (Trace.didHit && !Trace.startedInSolid) {
      return;
    }
    const bIsSelf = Victim === Attacker;
    if (!bIsSelf && !bFriendlyFire && Victim.GetTeamNumber() === Attacker.GetTeamNumber()) {
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
        damageTypes: CSDamageTypes.BLAST,
        attacker: Attacker,
        inflictor: Attacker
      }
    );
    if (!bIsSelf && DamageDealt > 0) {
      SpawnBloodSplatter(Origin, Victim);
    }
    Instance3.Msg(`${LogPrefix} ${Attacker.GetPlayerController()?.GetPlayerName()} Damaged ${Victim.GetPlayerController()?.GetPlayerName()} : ${CalculatedDmg}d : ${CalculatedKb}k (${Direction.x}, ${Direction.y}, ${Direction.z}) : ${Falloff}f : ${RangeScale.toFixed(2)}r`);
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
function EvaluateDamageCurve(Curve, Distance) {
  const First = Curve[0];
  if (!First) {
    return 1;
  }
  if (Distance <= First.Distance) {
    return First.Scale;
  }
  for (let Index = 1; Index < Curve.length; Index++) {
    const Previous = Curve[Index - 1];
    const Next = Curve[Index];
    if (Previous && Next && Distance <= Next.Distance) {
      const Alpha = (Distance - Previous.Distance) / Math.max(1, Next.Distance - Previous.Distance);
      return Previous.Scale + (Next.Scale - Previous.Scale) * Alpha;
    }
  }
  const Last = Curve[Curve.length - 1];
  return Last ? Last.Scale : 1;
}
function GetRangeDamageScale(Attacker, Victim, Falloff) {
  if (!Falloff) {
    return 1;
  }
  const Distance = FVectorMath.Size(FVectorMath.Subtract(GetChestPosition(Victim), GetChestPosition(Attacker)));
  return GetDistanceDamageScale(Distance, Falloff);
}
function TraceHitscan(Shooter, Start, End, MaxHits) {
  const Ignored = [Shooter];
  const Hits = [];
  let StopPoint = End;
  for (let TraceCount = 0; TraceCount < MaxHitscanTraces; TraceCount++) {
    const Trace = Instance3.TraceLine({ start: Start, end: End, ignoreEntity: Ignored, traceHitboxes: true });
    if (!Trace.didHit) {
      StopPoint = End;
      break;
    }
    StopPoint = Trace.end;
    const Victim = Trace.hitEntity;
    if (!IsPlayerPawn(Victim)) {
      break;
    }
    Ignored.push(Victim);
    if (!Victim.IsAlive() || !bFriendlyFire && Victim.GetTeamNumber() === Shooter.GetTeamNumber()) {
      continue;
    }
    Hits.push({ Victim, Trace });
    if (Hits.length >= MaxHits) {
      break;
    }
  }
  return { Hits, End: StopPoint };
}
function GetSpreadDirection(Aim, SpreadDegrees) {
  const Radius = SpreadDegrees * Math.sqrt(Math.random());
  const Around = Math.random() * Math.PI * 2;
  return FVectorMath.GetForwardVector(
    {
      pitch: Aim.pitch + Radius * Math.sin(Around),
      yaw: Aim.yaw + Radius * Math.cos(Around),
      roll: 0
    }
  );
}
function ApplyKnockback(Victim, Direction, Speed) {
  const Push = Victim.GetGroundEntity() ? FVectorMath.GetSafeNormal(FVectorMath.Add(Direction, GroundedKnockbackLift)) : Direction;
  Victim.Teleport({ velocity: FVectorMath.Add(Victim.GetAbsVelocity(), FVectorMath.Scale(Push, Speed)) });
}
function GetHeightAboveGround(Pawn, MaxDistance) {
  if (Pawn.GetGroundEntity()) {
    return 0;
  }
  const Start = FVectorMath.Add(Pawn.GetAbsOrigin(), GroundTraceLift);
  const Trace = Instance3.TraceLine(
    {
      start: Start,
      end: FVectorMath.Add(Start, { x: 0, y: 0, z: -(MaxDistance + GroundTraceLift.z) }),
      ignorePlayers: true
    }
  );
  if (!Trace.didHit) {
    return MaxDistance;
  }
  return Trace.startedInSolid ? 0 : Math.max(0, Start.z - Trace.end.z - GroundTraceLift.z);
}
function ApplyBulletFalloff(Event, Falloff) {
  const Attacker = Event.attacker;
  const Weapon = Event.weapon;
  const bIsBullet = (Event.damageTypes & (CSDamageTypes.BULLET | CSDamageTypes.BUCKSHOT)) !== 0;
  if (!Falloff || !Weapon || !bIsBullet || !IsPlayerPawn(Attacker) || Attacker === Event.player) {
    return;
  }
  if (Weapon.GetData().GetType() === CSWeaponType.KNIFE) {
    return;
  }
  const BulletTravel = FVectorMath.Size(FVectorMath.Subtract(GetChestPosition(Event.player), Attacker.GetEyePosition()));
  const CsRangeScale = Math.pow(Weapon.GetData().GetRangeModifier(), BulletTravel / 500);
  const RangeScale = GetRangeDamageScale(Attacker, Event.player, Falloff);
  const Damage = Math.max(1, Math.round(Event.damage / CsRangeScale * RangeScale));
  if (bDebug) {
    Instance3.Msg(`${LogPrefix} bullet falloff: ${Math.round(BulletTravel)}u x${RangeScale.toFixed(2)} (${Math.round(Event.damage)} -> ${Damage})`);
  }
  return { damage: Damage };
}

// src/bm_launcher.ts
import { Instance as Instance4, CSInputs } from "cs_script/point_script";
var FireFxLifetime = 3;
var GLaunchers = /* @__PURE__ */ new Map();
function EquipLauncher(Pawn, Slot, WeaponName, Settings) {
  const Launchers = (GLaunchers.get(Slot) ?? []).filter((Other) => {
    return Other.WeaponName !== WeaponName;
  });
  Launchers.push(
    {
      Settings,
      WeaponName,
      Clip: Settings.ClipSize,
      MaxClip: Settings.ClipSize,
      NextFireTime: 0,
      NextReloadTime: void 0,
      ChargeStartTime: void 0
    }
  );
  GLaunchers.set(Slot, Launchers);
  EmptyRealGun(Pawn, WeaponName);
}
function ClearLauncher(Slot) {
  GLaunchers.delete(Slot);
}
function TickLauncher(Pawn, Slot, Now) {
  const Launchers = GLaunchers.get(Slot);
  if (!Launchers) {
    return void 0;
  }
  const Active = Pawn.GetActiveWeapon();
  let FiredWeapon = void 0;
  for (const State of Launchers) {
    const Weapon = EmptyRealGun(Pawn, State.WeaponName);
    if (!Weapon || Active !== Weapon) {
      State.NextReloadTime = void 0;
      State.ChargeStartTime = void 0;
      continue;
    }
    if (TickHeldLauncher(Pawn, State, Now)) {
      FiredWeapon = State.WeaponName;
    }
  }
  return FiredWeapon;
}
function GetLauncherAmmo(Pawn, Slot) {
  const Launchers = GLaunchers.get(Slot);
  const Active = Pawn.GetActiveWeapon();
  if (!Launchers || !Active) {
    return void 0;
  }
  for (const State of Launchers) {
    if (Pawn.FindWeapon(State.WeaponName) === Active) {
      return { Clip: State.Clip, MaxClip: State.MaxClip, bReloading: State.NextReloadTime !== void 0, ChargeFraction: GetChargeFraction(State) };
    }
  }
  return void 0;
}
function TickHeldLauncher(Pawn, State, Now) {
  const bFireHeld = Pawn.IsInputPressed(CSInputs.ATTACK) && !Pawn.IsBuyMenuOpen() && !Instance4.IsFreezePeriod();
  if (bFireHeld && State.Clip > 0) {
    State.NextReloadTime = void 0;
    if (Now < State.NextFireTime) {
      State.ChargeStartTime = void 0;
      return false;
    }
    if (State.Settings.ChargeTime > 0) {
      if (State.ChargeStartTime === void 0) {
        State.ChargeStartTime = Now;
      }
      if (Now - State.ChargeStartTime < State.Settings.ChargeTime) {
        return false;
      }
    }
    State.ChargeStartTime = void 0;
    State.Clip--;
    const bHeldThrough = Now - State.NextFireTime < TickInterval * 1.5;
    State.NextFireTime = (bHeldThrough ? State.NextFireTime : Now) + State.Settings.FireInterval;
    SpawnFireFx(Pawn, State.Settings);
    return true;
  }
  State.ChargeStartTime = void 0;
  TickReload(Pawn, State, Now);
  return false;
}
function GetChargeFraction(State) {
  if (State.ChargeStartTime === void 0 || State.Settings.ChargeTime <= 0) {
    return 0;
  }
  return Math.min(1, (Instance4.GetGameTime() - State.ChargeStartTime) / State.Settings.ChargeTime);
}
function TickReload(Pawn, State, Now) {
  if (!CanReload(State)) {
    State.NextReloadTime = void 0;
    return;
  }
  if (State.NextReloadTime === void 0) {
    State.NextReloadTime = Math.max(Now, State.NextFireTime) + State.Settings.ReloadFirstTime;
    return;
  }
  if (Now < State.NextReloadTime) {
    return;
  }
  State.Clip = State.Settings.ReloadEachTime > 0 ? State.Clip + 1 : State.Settings.ClipSize;
  State.NextReloadTime = CanReload(State) ? Now + State.Settings.ReloadEachTime : void 0;
}
function CanReload(State) {
  return State.Clip < State.Settings.ClipSize;
}
function EmptyRealGun(Pawn, WeaponName) {
  const Weapon = Pawn.FindWeapon(WeaponName);
  if (!Weapon) {
    return void 0;
  }
  if (Weapon.GetClipAmmo() !== 0) {
    Weapon.SetClipAmmo(0);
  }
  if (Weapon.GetReserveAmmo() !== 0) {
    Weapon.SetReserveAmmo(0);
  }
  return Weapon;
}
function SpawnFireFx(Pawn, Settings) {
  if (Settings.FireFxTemplate !== "") {
    SpawnTemporaryTemplate(Settings.FireFxTemplate, Pawn.GetEyePosition(), FireFxLifetime);
  }
}

// src/bm_classes.ts
var EPlayerClass = /* @__PURE__ */ ((EPlayerClass2) => {
  EPlayerClass2["None"] = "none";
  EPlayerClass2["Demoman"] = "demo";
  EPlayerClass2["Solider"] = "soldier";
  EPlayerClass2["Medic"] = "medic";
  EPlayerClass2["Railer"] = "railer";
  return EPlayerClass2;
})(EPlayerClass || {});
var TF2HitscanFalloff = { RampUp: 1.5, FallOff: 0.5, OptimalDistance: 512 };
var TF2RocketFalloff = { RampUp: 1.25, FallOff: 0.5, OptimalDistance: 512 };
var TF2StickyFalloff = { RampUp: 1.1, FallOff: 0.9, OptimalDistance: 512 };
var RailerShotFalloff = [
  { Distance: 0, Scale: 1 },
  { Distance: 512, Scale: 1 },
  { Distance: 1536, Scale: 0.4 }
];
var RailerBeamFalloff = [
  { Distance: 0, Scale: 1 },
  { Distance: 1024, Scale: 1 },
  { Distance: 3072, Scale: 0.5 }
];
var SoldierSettings = {
  DisplayName: "Soldier",
  Primary: "weapon_awp",
  Secondary: "",
  Melee: "weapon_knife",
  Health: 150,
  SizeScale: 1.25,
  PrimaryLauncher: {
    FireInterval: 0.8,
    ClipSize: 4,
    ReloadFirstTime: 0.92,
    ReloadEachTime: 0.8,
    ChargeTime: 0,
    FireFxTemplate: "rocket_fire_template"
  },
  SecondaryLauncher: void 0,
  RocketDamage: 80,
  RocketRadius: 160,
  RocketSpeed: 1200,
  RocketKnockback: 400,
  RocketLifetime: 10,
  RocketFalloff: TF2RocketFalloff
};
var DemoSettings = {
  DisplayName: "Demoman",
  Primary: "weapon_sawedoff",
  Secondary: "weapon_deagle",
  Melee: "",
  Health: 130,
  SizeScale: 1,
  PrimaryLauncher: {
    FireInterval: 0.6,
    ClipSize: 6,
    ReloadFirstTime: 1.09,
    ReloadEachTime: 0.67,
    ChargeTime: 0,
    FireFxTemplate: "sticky_fire_template"
  },
  SecondaryLauncher: {
    FireInterval: 0.6,
    ClipSize: 4,
    ReloadFirstTime: 1.24,
    ReloadEachTime: 0.6,
    ChargeTime: 0,
    FireFxTemplate: "pipe_fire_template"
  },
  StickyDetonateKey: CSInputs2.ATTACK2,
  StickyMax: 6,
  StickyArmTime: 0.8,
  StickyLaunchSpeed: 900,
  StickyLaunchUp: 150,
  StickyRadius: 160,
  StickyDamage: 90,
  StickyKnockback: 600,
  StickyFalloff: TF2StickyFalloff,
  StickyFalloffTime: 5,
  PipeLaunchSpeed: 1337,
  PipeLaunchUp: 150,
  PipeRadius: 160,
  PipeDamage: 40,
  PipeKnockback: 1e3,
  PipeFalloff: TF2RocketFalloff,
  PipeLifetime: 5
};
var MedicSettings = {
  DisplayName: "Medic",
  Primary: "weapon_nova",
  Secondary: "",
  Melee: "weapon_knife",
  Health: 150,
  SizeScale: 0.9,
  PrimaryLauncher: void 0,
  SecondaryLauncher: void 0,
  BulletFalloff: TF2HitscanFalloff,
  Range: 450,
  BreakRange: 540,
  HealPerSec: 24,
  OverhealMult: 1.5,
  OverhealDecayPerSec: 3.3,
  UberSecondsToFill: 40,
  UberDuration: 8
};
var RailerSettings = {
  DisplayName: "Railer",
  Primary: "weapon_famas",
  Secondary: "weapon_revolver",
  Melee: "",
  Health: 100,
  SizeScale: 0.8,
  PrimaryLauncher: {
    FireInterval: 0.08,
    ClipSize: 20,
    ReloadFirstTime: 1.6,
    ReloadEachTime: 0,
    ChargeTime: 0,
    FireFxTemplate: "rail_shot_fire_template"
  },
  SecondaryLauncher: {
    FireInterval: 0.5,
    ClipSize: 1,
    ReloadFirstTime: 3,
    ReloadEachTime: 3,
    ChargeTime: 1,
    FireFxTemplate: "rail_fire_template"
  },
  ShotDamage: 6,
  ShotKnockback: 120,
  ShotRange: 4096,
  ShotSpread: 2,
  ShotFalloff: RailerShotFalloff,
  BeamDamage: 110,
  BeamRange: 8192,
  BeamHeadshotMultiplier: 1.5,
  bBeamPierces: true,
  BeamFalloff: RailerBeamFalloff
};
var StickyTemplateName = "sticky_template";
var RocketTemplateName = "rocket_template";
var PipeTemplateName = "pipe_template";
var RailBeamTemplateName = "rail_beam_template";
var RailBeamEndName = "rail_beam_end";
var RailImpactTemplateName = "rail_impact_template";
var RailBeamLifetime = 0.4;
var RailImpactLifetime = 2;
var RailTracerTemplateName = "rail_tracer_template";
var RailTracerEndName = "rail_tracer_end";
var RailTracerLifetime = 0.06;
var MaxBeamHits = 8;
var DefaultHealth = 100;
var DefaultSizeScale = 1;
var StrippedGearSlots = [CSGearSlot.RIFLE, CSGearSlot.PISTOL, CSGearSlot.KNIFE, CSGearSlot.GRENADES];
var NoClassStrippedGearSlots = [CSGearSlot.RIFLE, CSGearSlot.PISTOL, CSGearSlot.GRENADES];
var NoClassMelee = "weapon_knife";
var BeamStartDrop = { x: 0, y: 0, z: 12 };
var UnarmedStickyColor = { r: 240, g: 240, b: 240 };
var UberReadyColor = { r: 255, g: 255, b: 255 };
function ApplyBody(Pawn, Health, SizeScale) {
  Pawn.SetMaxHealth(Health);
  Pawn.SetHealth(Health);
  Pawn.SetModelScale(SizeScale);
}
function RestoreDefaultBody(Pawn) {
  ApplyBody(Pawn, DefaultHealth, DefaultSizeScale);
}
function IsBulletDamage(Event) {
  return (Event.damageTypes & (CSDamageTypes2.BULLET | CSDamageTypes2.BUCKSHOT)) !== 0;
}
function StripGearSlots(Pawn, GearSlots) {
  for (const GearSlot of GearSlots) {
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
    StripGearSlots(Pawn, StrippedGearSlots);
    ApplyBody(Pawn, this.Settings.Health, this.Settings.SizeScale);
    if (this.Settings.Melee !== "") {
      Pawn.GiveNamedItem(this.Settings.Melee);
    }
    const bHasSecondary = this.Settings.Secondary !== "" && this.Settings.Secondary !== this.Settings.Primary;
    if (bHasSecondary) {
      Pawn.GiveNamedItem(this.Settings.Secondary);
    }
    Pawn.GiveNamedItem(this.Settings.Primary, true);
    const Slot = GetPlayerSlot(Pawn);
    if (this.Settings.PrimaryLauncher) {
      EquipLauncher(Pawn, Slot, this.Settings.Primary, this.Settings.PrimaryLauncher);
    }
    if (bHasSecondary && this.Settings.SecondaryLauncher) {
      EquipLauncher(Pawn, Slot, this.Settings.Secondary, this.Settings.SecondaryLauncher);
    }
    this.OnLoadoutApplied(Pawn);
  }
  // Override for class-specific setup. Runs after the shared loadout.
  OnLoadoutApplied(Pawn) {
  }
  // Called when someone playing this class fires their primary
  OnPrimaryFire(Pawn, Slot, Now) {
  }
  // Called when someone playing this class fires their secondary
  OnSecondaryFire(Pawn, Slot, Now) {
  }
  // Called every tick, whether or not anyone is playing this class
  TickWorld(Now, DeltaTime) {
  }
  // Called every tick for each living player of this class, after every class's TickWorld
  TickPlayer(Pawn, Slot, Now, DeltaTime) {
  }
  // Called every tick after every player has been ticked
  TickWorldLate(Now, DeltaTime) {
  }
  OnRoundStart() {
  }
  // Called on every class when a player dies, respawns, switches class or leaves, so their leftovers get cleaned up
  ClearPlayer(Slot) {
  }
  // Override to change or block damage dealt by this class
  ModifyOutgoingDamage(Event) {
    if (this.IsPrimaryBulletDamage(Event) || this.IsSecondaryBulletDamage(Event)) {
      return { abort: true };
    }
  }
  // Called for every damage event, whoever deals it (e.g. über protecting a patient)
  ModifyAnyDamage(Event) {
    return;
  }
  // Override to put a counter on this class's HUD. undefined = none.
  GetHudCounter(Slot) {
    return void 0;
  }
  // True for the primary's own bullets, as opposed to explosions or beams the script deals in its name
  IsPrimaryBulletDamage(Event) {
    return IsBulletDamage(Event) && IsWeapon(Event.weapon, this.Settings.Primary);
  }
  // True for the secondary's own bullets
  IsSecondaryBulletDamage(Event) {
    return IsBulletDamage(Event) && this.Settings.Secondary !== "" && IsWeapon(Event.weapon, this.Settings.Secondary);
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
    if (Rocket.Models.length === 0) {
      Instance5.DebugSphere({ center: Rocket.Position, radius: 3, duration: TickInterval * 2, color: GetTeamColor(Rocket.Owner) });
    }
    return true;
  }
};
var UDemomanClass = class extends UPlayerClass {
  PlayerStates = /* @__PURE__ */ new Map();
  Pipes = [];
  constructor() {
    super(DemoSettings);
  }
  OnPrimaryFire(Pawn, Slot, Now) {
    const Sticky = {
      ...LaunchProjectile(Pawn, this.Settings.StickyLaunchSpeed, this.Settings.StickyLaunchUp, 1, StickyTemplateName),
      bStuck: false,
      ArmedAt: Now + this.Settings.StickyArmTime,
      bTintedArmed: false
    };
    TintProjectile(Sticky, UnarmedStickyColor);
    const State = this.GetPlayerState(Slot);
    State.Stickies.push(Sticky);
    if (!bDebug) {
      while (State.Stickies.length > this.Settings.StickyMax) {
        const Oldest = State.Stickies.shift();
        if (Oldest) {
          DestroyProjectile(Oldest);
        }
      }
    }
  }
  OnSecondaryFire(Pawn, Slot, Now) {
    const Pipe = LaunchProjectile(Pawn, this.Settings.PipeLaunchSpeed, this.Settings.PipeLaunchUp, 1, PipeTemplateName);
    this.Pipes.push(Pipe);
  }
  TickWorld(Now, DeltaTime) {
    this.Pipes = this.Pipes.filter((Pipe) => {
      return this.StepPipe(Pipe, Now, DeltaTime);
    });
  }
  TickPlayer(Pawn, Slot, Now, DeltaTime) {
    const State = this.GetPlayerState(Slot);
    for (const Sticky of State.Stickies) {
      if (!Sticky.bStuck && MoveProjectile(Sticky, DeltaTime, false)) {
        Sticky.bStuck = true;
      }
    }
    for (const Sticky of State.Stickies) {
      const bArmed = Now >= Sticky.ArmedAt;
      if (Sticky.Models.length === 0) {
        Instance5.DebugSphere({ center: Sticky.Position, radius: 4, duration: TickInterval * 2, color: bArmed ? GetTeamColor(Pawn) : UnarmedStickyColor });
      } else if (bArmed && !Sticky.bTintedArmed) {
        TintProjectile(Sticky, GetTeamColor(Pawn));
        Sticky.bTintedArmed = true;
      }
    }
    const bDown = Pawn.IsInputPressed(this.Settings.StickyDetonateKey);
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
      const bYoungSticky = Now - Sticky.SpawnedAt < this.Settings.StickyFalloffTime;
      const RangeFalloff = bYoungSticky ? this.Settings.StickyFalloff : void 0;
      Explode(Sticky.Position, Pawn, this.Settings.StickyRadius, this.Settings.StickyDamage, this.Settings.StickyKnockback, RangeFalloff);
    }
    State.Stickies = StillArming;
  }
  OnRoundStart() {
    for (const Slot of this.PlayerStates.keys()) {
      this.ClearPlayer(Slot);
    }
    for (const Pipe of this.Pipes) {
      DestroyProjectile(Pipe);
    }
    this.Pipes = [];
  }
  ClearPlayer(Slot) {
    const State = this.PlayerStates.get(Slot);
    if (!State) {
      return;
    }
    for (const Sticky of State.Stickies) {
      DestroyProjectile(Sticky);
    }
    this.PlayerStates.delete(Slot);
  }
  GetHudCounter(Slot) {
    const State = this.PlayerStates.get(Slot);
    return { Label: "Stickies", Count: State ? State.Stickies.length : 0, Max: bDebug ? 0 : this.Settings.StickyMax };
  }
  GetPlayerState(Slot) {
    let State = this.PlayerStates.get(Slot);
    if (!State) {
      State = { Stickies: [], bDetonateHeld: false };
      this.PlayerStates.set(Slot, State);
    }
    return State;
  }
  StepPipe(Pipe, Now, DeltaTime) {
    if (!Pipe.Owner.IsValid() || Now - Pipe.SpawnedAt > this.Settings.PipeLifetime) {
      DestroyProjectile(Pipe);
      return false;
    }
    if (MoveProjectile(Pipe, DeltaTime, true)) {
      DestroyProjectile(Pipe);
      Explode(Pipe.Position, Pipe.Owner, this.Settings.PipeRadius, this.Settings.PipeDamage, this.Settings.PipeKnockback, this.Settings.PipeFalloff);
      return false;
    }
    if (Pipe.Models.length === 0) {
      Instance5.DebugSphere({ center: Pipe.Position, radius: 3, duration: TickInterval * 2, color: GetTeamColor(Pipe.Owner) });
    }
    return true;
  }
};
var UMedicClass = class extends UPlayerClass {
  PlayerStates = /* @__PURE__ */ new Map();
  DecayAccumulators = /* @__PURE__ */ new Map();
  // overheal decay, for any player
  HealedThisTick = /* @__PURE__ */ new Set();
  UberedThisTick = /* @__PURE__ */ new Set();
  UberedPawns = /* @__PURE__ */ new Set();
  GlowingPawns = /* @__PURE__ */ new Set();
  HudLine = 0;
  constructor() {
    super(MedicSettings);
  }
  OnLoadoutApplied(Pawn) {
    const Knife = Pawn.FindWeaponBySlot(CSGearSlot.KNIFE);
    if (Knife) {
      Pawn.SwitchToWeapon(Knife);
    }
  }
  TickWorld(Now, DeltaTime) {
    this.HealedThisTick = /* @__PURE__ */ new Set();
    this.UberedThisTick = /* @__PURE__ */ new Set();
    this.HudLine = 0;
  }
  TickPlayer(Pawn, Slot, Now, DeltaTime) {
    const State = this.GetPlayerState(Slot);
    const ActiveWeapon = Pawn.GetActiveWeapon();
    const bHoldingMedigun = !!ActiveWeapon && ActiveWeapon.GetData().GetType() === CSWeaponType2.KNIFE;
    const bFiring = bHoldingMedigun && Pawn.IsInputPressed(CSInputs2.ATTACK);
    let Target = bFiring ? State.HealTarget : void 0;
    if (Target && !this.IsHealTargetValid(Pawn, Target)) {
      Target = void 0;
    }
    if (bFiring && !Target) {
      Target = this.AcquireHealTarget(Pawn);
    }
    State.HealTarget = Target;
    if (Target) {
      this.HealedThisTick.add(Target);
      const MaxHealth = Target.GetMaxHealth();
      const OverhealCap = Math.floor(MaxHealth * this.Settings.OverhealMult);
      const Health = Target.GetHealth();
      if (Health < OverhealCap) {
        State.HealAccumulator += this.Settings.HealPerSec * DeltaTime;
        const WholeHealth = Math.floor(State.HealAccumulator);
        if (WholeHealth > 0) {
          Target.SetHealth(Math.min(OverhealCap, Health + WholeHealth));
          State.HealAccumulator -= WholeHealth;
        }
      }
      if (Now >= State.UberEndTime) {
        const ChargeRate = 100 / this.Settings.UberSecondsToFill * (Health < MaxHealth ? 1 : 0.5);
        State.UberCharge = Math.min(100, State.UberCharge + ChargeRate * DeltaTime);
      }
      Instance5.DebugLine(
        {
          start: FVectorMath.Subtract(Pawn.GetEyePosition(), BeamStartDrop),
          end: GetChestPosition(Target),
          duration: TickInterval * 2,
          color: GetTeamColor(Pawn)
        }
      );
    }
    if (Now >= State.UberEndTime && State.UberCharge >= 100 && bHoldingMedigun && Pawn.IsInputPressed(CSInputs2.ATTACK2)) {
      State.UberEndTime = Now + this.Settings.UberDuration;
    }
    const bUberActive = Now < State.UberEndTime;
    if (bUberActive) {
      State.UberCharge = 100 * (State.UberEndTime - Now) / this.Settings.UberDuration;
      this.UberedThisTick.add(Pawn);
      if (Target) {
        this.UberedThisTick.add(Target);
      }
    }
    const Controller = Pawn.GetPlayerController();
    const MedicName = Controller ? Controller.GetPlayerName() : "medic";
    const ActiveText = bUberActive ? "  ACTIVE" : "";
    const PatientText = Target ? `  | patient ${Target.GetHealth()} HP` : "";
    Instance5.DebugScreenText(
      {
        text: `${MedicName}  \xDCBER ${Math.floor(State.UberCharge)}%${ActiveText}${PatientText}`,
        x: 40,
        y: 220 + this.HudLine * 18,
        duration: TickInterval * 2,
        color: State.UberCharge >= 100 ? UberReadyColor : GetTeamColor(Pawn)
      }
    );
    this.HudLine++;
  }
  TickWorldLate(Now, DeltaTime) {
    this.TickOverhealDecay(DeltaTime);
    this.UpdateUberGlows();
    this.UberedPawns = this.UberedThisTick;
  }
  OnRoundStart() {
    this.PlayerStates.clear();
  }
  ClearPlayer(Slot) {
    this.PlayerStates.delete(Slot);
    this.DecayAccumulators.delete(Slot);
  }
  ModifyOutgoingDamage(Event) {
    if (Event.weapon && Event.weapon.GetData().GetType() === CSWeaponType2.KNIFE) {
      return { abort: true };
    }
    return ApplyBulletFalloff(Event, this.Settings.BulletFalloff);
  }
  ModifyAnyDamage(Event) {
    if (this.UberedPawns.has(Event.player)) {
      return { abort: true };
    }
    return;
  }
  GetPlayerState(Slot) {
    let State = this.PlayerStates.get(Slot);
    if (!State) {
      State = { HealTarget: void 0, HealAccumulator: 0, UberCharge: 0, UberEndTime: 0 };
      this.PlayerStates.set(Slot, State);
    }
    return State;
  }
  IsHealTargetValid(Medic, Target) {
    if (!Target.IsValid() || !Target.IsAlive() || Target.GetTeamNumber() !== Medic.GetTeamNumber()) {
      return false;
    }
    const EyePosition = Medic.GetEyePosition();
    const TargetChest = GetChestPosition(Target);
    if (FVectorMath.Size(FVectorMath.Subtract(TargetChest, EyePosition)) > this.Settings.BreakRange) {
      return false;
    }
    return !Instance5.TraceLine({ start: EyePosition, end: TargetChest, ignorePlayers: true }).didHit;
  }
  AcquireHealTarget(Medic) {
    const EyePosition = Medic.GetEyePosition();
    const Forward = FVectorMath.GetForwardVector(Medic.GetEyeAngles());
    const End = FVectorMath.Add(EyePosition, FVectorMath.Scale(Forward, this.Settings.Range));
    const HitEntity = Instance5.TraceSphere({ start: EyePosition, end: End, radius: 12, ignoreEntity: Medic }).hitEntity;
    if (IsPlayerPawn(HitEntity) && HitEntity.IsAlive() && HitEntity.GetTeamNumber() === Medic.GetTeamNumber()) {
      return HitEntity;
    }
    return void 0;
  }
  TickOverhealDecay(DeltaTime) {
    ForEachLivePawn((Pawn, Slot) => {
      const MaxHealth = Pawn.GetMaxHealth();
      const Health = Pawn.GetHealth();
      if (Health > MaxHealth && !this.HealedThisTick.has(Pawn)) {
        let Accumulator = (this.DecayAccumulators.get(Slot) ?? 0) + this.Settings.OverhealDecayPerSec * DeltaTime;
        const WholeDecay = Math.floor(Accumulator);
        if (WholeDecay > 0) {
          Pawn.SetHealth(Math.max(MaxHealth, Health - WholeDecay));
          Accumulator -= WholeDecay;
        }
        this.DecayAccumulators.set(Slot, Accumulator);
      } else {
        this.DecayAccumulators.set(Slot, 0);
      }
    });
  }
  UpdateUberGlows() {
    for (const Pawn of this.GlowingPawns) {
      if (!this.UberedThisTick.has(Pawn) && Pawn.IsValid()) {
        Pawn.Unglow();
      }
    }
    for (const Pawn of this.UberedThisTick) {
      if (!this.GlowingPawns.has(Pawn)) {
        Pawn.Glow(GetTeamColor(Pawn));
      }
    }
    this.GlowingPawns = new Set(this.UberedThisTick);
  }
};
var URailerClass = class extends UPlayerClass {
  constructor() {
    super(RailerSettings);
  }
  OnPrimaryFire(Pawn, Slot, Now) {
    const Start = Pawn.GetEyePosition();
    const Direction = GetSpreadDirection(Pawn.GetEyeAngles(), this.Settings.ShotSpread);
    const Result = TraceHitscan(Pawn, Start, FVectorMath.Add(Start, FVectorMath.Scale(Direction, this.Settings.ShotRange)), 1);
    const Weapon = Pawn.FindWeapon(this.Settings.Primary);
    for (const Hit of Result.Hits) {
      const RangeScale = EvaluateDamageCurve(this.Settings.ShotFalloff, GetHitDistance(Hit, Start));
      DealShockDamage(Pawn, Hit.Victim, this.Settings.ShotDamage * RangeScale, Weapon);
      ApplyKnockback(Hit.Victim, Direction, this.Settings.ShotKnockback * RangeScale);
    }
    SpawnBeam(RailTracerTemplateName, RailTracerEndName, FVectorMath.Subtract(Start, BeamStartDrop), Result.End, RailTracerLifetime, GetTeamColor(Pawn));
  }
  OnSecondaryFire(Pawn, Slot, Now) {
    const Start = Pawn.GetEyePosition();
    const Direction = FVectorMath.GetForwardVector(Pawn.GetEyeAngles());
    const MaxHits = this.Settings.bBeamPierces ? MaxBeamHits : 1;
    const Result = TraceHitscan(Pawn, Start, FVectorMath.Add(Start, FVectorMath.Scale(Direction, this.Settings.BeamRange)), MaxHits);
    const Weapon = Pawn.FindWeapon(this.Settings.Secondary);
    for (const Hit of Result.Hits) {
      this.HitWithBeam(Pawn, Hit, Start, Weapon);
    }
    SpawnBeam(RailBeamTemplateName, RailBeamEndName, FVectorMath.Subtract(Start, BeamStartDrop), Result.End, RailBeamLifetime, GetTeamColor(Pawn));
    SpawnTemporaryTemplate(RailImpactTemplateName, Result.End, RailImpactLifetime);
  }
  HitWithBeam(Shooter, Hit, Start, Weapon) {
    const Distance = GetHitDistance(Hit, Start);
    const RangeScale = EvaluateDamageCurve(this.Settings.BeamFalloff, Distance);
    const bHeadshot = Hit.Trace.hitGroup === CSHitGroup.HEAD;
    const Damage = this.Settings.BeamDamage * RangeScale * (bHeadshot ? this.Settings.BeamHeadshotMultiplier : 1);
    if (DealShockDamage(Shooter, Hit.Victim, Damage, Weapon) > 0) {
      SpawnBloodSplatter(Start, Hit.Victim);
    }
    if (bDebug) {
      Instance5.Msg(`${LogPrefix} rail beam: ${Math.round(Distance)}u x${RangeScale.toFixed(2)}${bHeadshot ? " headshot" : ""} -> ${Math.round(Damage)}`);
    }
  }
};
function GetHitDistance(Hit, Start) {
  return FVectorMath.Size(FVectorMath.Subtract(Hit.Trace.end, Start));
}
function DealShockDamage(Shooter, Victim, Damage, Weapon) {
  return Victim.TakeDamage(
    {
      damage: Damage,
      damageTypes: CSDamageTypes2.SHOCK,
      damageFlags: CSDamageFlags.IGNORE_ARMOR,
      attacker: Shooter,
      inflictor: Shooter,
      weapon: Weapon
    }
  );
}
var ClassDefinitions = {
  ["demo" /* Demoman */]: new UDemomanClass(),
  ["soldier" /* Solider */]: new USoldierClass(),
  ["medic" /* Medic */]: new UMedicClass(),
  ["railer" /* Railer */]: new URailerClass()
};
function GiveLoadout(Pawn, PlayerClass) {
  ClassDefinitions[PlayerClass].ApplyLoadout(Pawn);
}
function GiveNoClassLoadout(Pawn) {
  StripGearSlots(Pawn, NoClassStrippedGearSlots);
  const Knife = Pawn.FindWeaponBySlot(CSGearSlot.KNIFE);
  if (Knife) {
    Pawn.SwitchToWeapon(Knife);
  } else {
    Pawn.GiveNamedItem(NoClassMelee, true);
  }
}
function IsWeaponAllowed(PlayerClass, Weapon) {
  const Data = Weapon.GetData();
  if (!Data || Data.GetGearSlot() === CSGearSlot.C4) {
    return true;
  }
  const bIsKnife = Data.GetType() === CSWeaponType2.KNIFE;
  if (PlayerClass === "none" /* None */) {
    return bIsKnife;
  }
  const Settings = ClassDefinitions[PlayerClass].Settings;
  if (bIsKnife && Settings.Melee !== "") {
    return true;
  }
  for (const Allowed of [Settings.Primary, Settings.Secondary, Settings.Melee]) {
    if (Allowed !== "" && IsWeapon(Weapon, Allowed)) {
      return true;
    }
  }
  return false;
}

// src/bm_hud.ts
import { Instance as Instance6 } from "cs_script/point_script";
var DamageHudName = "damage_hud";
var DamageLabelId = "DamageNumber";
var DamageBatchWindow = 0.6;
var DamageShowTime = 0.85;
var AirshotLabelId = "AirshotText";
var AirshotShowTime = 2;
var GDamageNumberStates = /* @__PURE__ */ new Map();
var GLastAirshotTimes = /* @__PURE__ */ new Map();
var GbWarnedNoDamageHud = false;
function ShowDamageNumber(Slot, Damage) {
  const Hud = FindDamageHud();
  if (!Hud || Damage <= 0) {
    return;
  }
  const State = GetDamageNumberState(Slot);
  const Now = Instance6.GetGameTime();
  if (Now - State.LastDamageTime > DamageBatchWindow) {
    State.DamageTotal = 0;
  }
  State.DamageTotal += Damage;
  State.LastDamageTime = Now;
  State.bDamagePopA = !State.bDamagePopA;
  Hud.SetDialogVariableStringForPlayer(Slot, DamageLabelId, "damage", `-${Math.round(State.DamageTotal)}`);
  SetTimer(DamageShowTime, () => {
    const LaterHud = FindDamageHud();
    if (LaterHud && Instance6.GetGameTime() - State.LastDamageTime >= DamageShowTime - 0.01) {
      LaterHud.SetDialogVariableStringForPlayer(Slot, DamageLabelId, "damage", "");
    }
  });
}
function ShowAirshot(Slot) {
  const Hud = FindDamageHud();
  if (!Hud) {
    return;
  }
  const Now = Instance6.GetGameTime();
  GLastAirshotTimes.set(Slot, Now);
  Hud.SetHasClassForPlayer(Slot, AirshotLabelId, "Shown", true);
  SetTimer(AirshotShowTime, () => {
    if (GLastAirshotTimes.get(Slot) !== Now) {
      return;
    }
    GLastAirshotTimes.delete(Slot);
    const LaterHud = FindDamageHud();
    if (LaterHud) {
      LaterHud.SetHasClassForPlayer(Slot, AirshotLabelId, "Shown", false);
    }
  });
}
function ResetDamageNumbers(Slot) {
  GDamageNumberStates.delete(Slot);
  GLastAirshotTimes.delete(Slot);
  const Hud = FindDamageHud();
  if (Hud) {
    Hud.ResetForPlayer(Slot);
  }
}
function GetDamageNumberState(Slot) {
  let State = GDamageNumberStates.get(Slot);
  if (!State) {
    State = { DamageTotal: 0, LastDamageTime: 0, bDamagePopA: false };
    GDamageNumberStates.set(Slot, State);
  }
  return State;
}
function FindDamageHud() {
  const Hud = Instance6.FindEntityByName(DamageHudName);
  if (IsCustomHudLayout(Hud)) {
    return Hud;
  }
  if (!GbWarnedNoDamageHud) {
    GbWarnedNoDamageHud = true;
    const Problem = Hud ? "exists but isn't a custom_hud_layout" : "wasn't found";
    Instance6.Msg(`${LogPrefix} damage numbers: an entity named "${DamageHudName}" ${Problem}. Check the custom_hud_layout in Hammer, then do a full map build.`);
  }
  return void 0;
}
function IsCustomHudLayout(Ent) {
  return Ent !== void 0 && "SetDialogVariableStringForPlayer" in Ent && typeof Ent.SetDialogVariableStringForPlayer === "function";
}

// src/bm_bots.ts
import { Instance as Instance7 } from "cs_script/point_script";
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
var GBotAssignments = /* @__PURE__ */ new Map();
var GBotReadyAt = /* @__PURE__ */ new Map();
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
function ResetBotMode(Slot) {
  const Assignment = GBotAssignments.get(Slot);
  if (Assignment) {
    Assignment.bPlaced = false;
  }
  GBotReadyAt.set(Slot, Instance7.GetGameTime() + BotSpawnSettleTime);
}
function ForgetBot(Slot) {
  GBotAssignments.delete(Slot);
  GBotReadyAt.delete(Slot);
}
function FindFreeBotMarkers() {
  const Claimed = /* @__PURE__ */ new Set();
  for (const Assignment of GBotAssignments.values()) {
    Claimed.add(Assignment.Marker);
  }
  const FreeMarkers = /* @__PURE__ */ new Map();
  for (const [MarkerName, Mode] of BotMarkerModes) {
    for (const Marker of Instance7.FindEntitiesByName(MarkerName)) {
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
  Pawn.SetHealth(100);
}
function DriveBot(Pawn, Assignment) {
  if (Assignment.Mode === 0 /* Still */ || !Pawn.GetGroundEntity()) {
    return;
  }
  if (Assignment.Mode === 2 /* Jump */) {
    Pawn.Teleport({ velocity: { x: 0, y: 0, z: BotJumpSpeed } });
    return;
  }
  const Forward = FVectorMath.GetForwardVector({ pitch: 0, yaw: Assignment.Yaw, roll: 0 });
  Pawn.Teleport({ velocity: { x: Forward.x * BotRunSpeed, y: Forward.y * BotRunSpeed, z: Pawn.GetAbsVelocity().z } });
}

// src/bm_class_ui.ts
import { Instance as Instance8, CSInputs as CSInputs3 } from "cs_script/point_script";
var ClassUiName = "class_hud";
var MenuPanelId = "ClassMenu";
var BottomBarId = "BottomBar";
var IndicatorPanelId = "ClassIndicator";
var ClassNameLabelId = "ClassName";
var PickButtonPrefix = "Pick_";
var CloseButtonId = "CloseMenu";
var MenuToggleKey = CSInputs3.LOOK_AT_WEAPON;
var NoClassName = "No class";
var AmmoPanelId = "AmmoPanel";
var AmmoClipLabelId = "AmmoClip";
var AmmoSpareLabelId = "AmmoSpare";
var HealthPanelId = "HealthPanel";
var HealthValueLabelId = "HealthValue";
var HealthMaxLabelId = "HealthMax";
var CounterPanelId = "CounterPanel";
var CounterLabelId = "CounterLabel";
var CounterValueId = "CounterValue";
var CounterMaxId = "CounterMax";
var ChargeBarId = "ChargeBar";
var ChargeSteps = 10;
var HurtHealthFraction = 0.5;
var CriticalHealthFraction = 0.25;
var AllClasses = Object.values(EPlayerClass);
var GOpenMenus = /* @__PURE__ */ new Set();
var GOfferedMenus = /* @__PURE__ */ new Set();
var GShownAmmo = /* @__PURE__ */ new Map();
var GShownHealth = /* @__PURE__ */ new Map();
var GShownCharge = /* @__PURE__ */ new Map();
var GShownCounter = /* @__PURE__ */ new Map();
var GbWarnedNoClassUi = false;
function OpenClassMenu(Slot) {
  const Ui = FindClassUi();
  if (!Ui) {
    return;
  }
  GOpenMenus.add(Slot);
  Ui.SetHasClassForPlayer(Slot, MenuPanelId, "Open", true);
  Ui.SetInputCaptureEnabled(Slot, true);
}
function CloseClassMenu(Slot) {
  GOpenMenus.delete(Slot);
  const Ui = FindClassUi();
  if (!Ui) {
    return;
  }
  Ui.SetHasClassForPlayer(Slot, MenuPanelId, "Open", false);
  Ui.SetInputCaptureEnabled(Slot, false);
}
function ToggleClassMenu(Slot) {
  if (GOpenMenus.has(Slot)) {
    CloseClassMenu(Slot);
  } else {
    OpenClassMenu(Slot);
  }
}
function OfferClassMenu(Slot, PlayerClass) {
  if (GOfferedMenus.has(Slot) || PlayerClass !== "none" /* None */) {
    return;
  }
  GOfferedMenus.add(Slot);
  OpenClassMenu(Slot);
}
function TickClassMenuKey() {
  ForEachLivePawn((Pawn, Slot) => {
    const Controller = Pawn.GetPlayerController();
    if (!Controller || Controller.IsBot()) {
      return;
    }
    if (Pawn.WasInputJustPressed(MenuToggleKey)) {
      ToggleClassMenu(Slot);
    }
  });
}
function ReadClassMenuClick(Layout, ButtonId) {
  if (Layout.GetEntityName() !== ClassUiName) {
    return void 0;
  }
  if (ButtonId === CloseButtonId) {
    return "close";
  }
  if (!ButtonId.startsWith(PickButtonPrefix)) {
    return void 0;
  }
  const ClassValue = ButtonId.substring(PickButtonPrefix.length);
  for (const PlayerClass of AllClasses) {
    if (PlayerClass === ClassValue) {
      return PlayerClass;
    }
  }
  return void 0;
}
function ShowClassIndicator(Slot, PlayerClass, IsT) {
  const Ui = FindClassUi();
  if (!Ui) {
    return;
  }
  const DisplayName = PlayerClass === "none" /* None */ ? NoClassName : ClassDefinitions[PlayerClass].Settings.DisplayName;
  Ui.SetDialogVariableStringForPlayer(Slot, ClassNameLabelId, "classname", DisplayName);
  Ui.SetHasClassForPlayer(Slot, BottomBarId, "Shown", true);
  Ui.SetHasClassForPlayer(Slot, IndicatorPanelId, "Team_t", IsT);
  Ui.SetHasClassForPlayer(Slot, IndicatorPanelId, "Team_ct", !IsT);
  if (GOpenMenus.has(Slot)) {
    Ui.SetHasClassForPlayer(Slot, MenuPanelId, "Open", true);
    Ui.SetInputCaptureEnabled(Slot, true);
  }
}
function ShowAmmo(Slot, Ammo) {
  ShowCharge(Slot, Ammo ? Ammo.ChargeFraction : 0);
  const Key = Ammo ? `${Ammo.Clip}|${Ammo.bReloading}` : "";
  if ((GShownAmmo.get(Slot) ?? "") === Key) {
    return;
  }
  const Ui = FindClassUi();
  if (!Ui) {
    return;
  }
  GShownAmmo.set(Slot, Key);
  if (!Ammo) {
    Ui.SetHasClassForPlayer(Slot, AmmoPanelId, "Shown", false);
    return;
  }
  Ui.SetDialogVariableStringForPlayer(Slot, AmmoClipLabelId, "ammoclip", `${Ammo.Clip}`);
  Ui.SetDialogVariableStringForPlayer(Slot, AmmoSpareLabelId, "ammospare", `${Ammo.MaxClip}`);
  Ui.SetHasClassForPlayer(Slot, AmmoPanelId, "Reloading", Ammo.bReloading);
  Ui.SetHasClassForPlayer(Slot, AmmoPanelId, "Empty", Ammo.Clip === 0);
  Ui.SetHasClassForPlayer(Slot, AmmoPanelId, "Shown", true);
}
function ShowCharge(Slot, Fraction) {
  const Step = Fraction > 0 ? Math.min(ChargeSteps, Math.max(1, Math.ceil(Fraction * ChargeSteps))) : 0;
  const LastStep = GShownCharge.get(Slot) ?? 0;
  if (Step === LastStep) {
    return;
  }
  const Ui = FindClassUi();
  if (!Ui) {
    return;
  }
  GShownCharge.set(Slot, Step);
  if (LastStep > 0) {
    Ui.SetHasClassForPlayer(Slot, ChargeBarId, `Charge_${LastStep}`, false);
  }
  if (Step > 0) {
    Ui.SetHasClassForPlayer(Slot, ChargeBarId, `Charge_${Step}`, true);
  }
  Ui.SetHasClassForPlayer(Slot, ChargeBarId, "Shown", Step > 0);
}
function ShowCounter(Slot, Counter) {
  const Key = Counter ? `${Counter.Label}|${Counter.Count}|${Counter.Max}` : "";
  if ((GShownCounter.get(Slot) ?? "") === Key) {
    return;
  }
  const Ui = FindClassUi();
  if (!Ui) {
    return;
  }
  GShownCounter.set(Slot, Key);
  if (!Counter) {
    Ui.SetHasClassForPlayer(Slot, CounterPanelId, "Shown", false);
    return;
  }
  Ui.SetDialogVariableStringForPlayer(Slot, CounterLabelId, "counterlabel", Counter.Label);
  Ui.SetDialogVariableStringForPlayer(Slot, CounterValueId, "countervalue", `${Counter.Count}`);
  Ui.SetDialogVariableStringForPlayer(Slot, CounterMaxId, "countermax", Counter.Max > 0 ? `/ ${Counter.Max}` : "");
  Ui.SetHasClassForPlayer(Slot, CounterPanelId, "HasAny", Counter.Count > 0);
  Ui.SetHasClassForPlayer(Slot, CounterPanelId, "Full", Counter.Max > 0 && Counter.Count >= Counter.Max);
  Ui.SetHasClassForPlayer(Slot, CounterPanelId, "Shown", true);
}
function ShowHealth(Slot, Pawn) {
  const Health = Pawn ? Pawn.GetHealth() : 0;
  const MaxHealth = Pawn ? Math.max(1, Pawn.GetMaxHealth()) : 1;
  const Key = Pawn ? `${Health}|${MaxHealth}` : "";
  if ((GShownHealth.get(Slot) ?? "") === Key) {
    return;
  }
  const Ui = FindClassUi();
  if (!Ui) {
    return;
  }
  GShownHealth.set(Slot, Key);
  if (!Pawn) {
    Ui.SetHasClassForPlayer(Slot, HealthPanelId, "Shown", false);
    return;
  }
  const Fraction = Health / MaxHealth;
  Ui.SetDialogVariableStringForPlayer(Slot, HealthValueLabelId, "health", `${Health}`);
  Ui.SetDialogVariableStringForPlayer(Slot, HealthMaxLabelId, "maxhealth", `${MaxHealth}`);
  Ui.SetHasClassForPlayer(Slot, HealthPanelId, "Overhealed", Health > MaxHealth);
  Ui.SetHasClassForPlayer(Slot, HealthPanelId, "Hurt", Fraction <= HurtHealthFraction && Fraction > CriticalHealthFraction);
  Ui.SetHasClassForPlayer(Slot, HealthPanelId, "Critical", Fraction <= CriticalHealthFraction);
  Ui.SetHasClassForPlayer(Slot, HealthPanelId, "Shown", true);
}
function ResetClassUi(Slot) {
  GOpenMenus.delete(Slot);
  GOfferedMenus.delete(Slot);
  GShownAmmo.delete(Slot);
  GShownHealth.delete(Slot);
  GShownCharge.delete(Slot);
  GShownCounter.delete(Slot);
  const Ui = FindClassUi();
  if (!Ui) {
    return;
  }
  Ui.SetInputCaptureEnabled(Slot, false);
  Ui.ResetForPlayer(Slot);
}
function FindClassUi() {
  const Ui = Instance8.FindEntityByName(ClassUiName);
  if (IsCustomHudLayout2(Ui)) {
    return Ui;
  }
  if (!GbWarnedNoClassUi) {
    GbWarnedNoClassUi = true;
    const Problem = Ui ? "exists but isn't a custom_hud_layout" : "wasn't found";
    Instance8.Msg(`${LogPrefix} class menu: an entity named "${ClassUiName}" ${Problem}. Check the custom_hud_layout in Hammer, then do a full map build.`);
  }
  return void 0;
}
function IsCustomHudLayout2(Ent) {
  return Ent !== void 0 && "SetInputCaptureEnabled" in Ent && typeof Ent.SetInputCaptureEnabled === "function";
}

// src/bm_pickups.ts
import { Instance as Instance9 } from "cs_script/point_script";
var HealthKitSettings = {
  Name: "healthkit",
  HealFraction: 0.5,
  RespawnTime: 10,
  PickupRadius: 52,
  PickupHeight: 64,
  SpinDegreesPerSecond: 90,
  PickupFxTemplate: "healthkit_pickup_template",
  RespawnFxTemplate: "healthkit_respawn_template"
};
var HiddenScale = 1e-3;
var PickupBelowTolerance = 32;
var FxLifetime = 3;
var RescanInterval = 1;
var KitClassNames = ["prop_dynamic", "prop_dynamic_override"];
var DebugKitColor = { r: 80, g: 230, b: 120 };
var GHealthKits = [];
var GNextRescanTime = 0;
function TickHealthKits(Now) {
  if (Now >= GNextRescanTime) {
    RescanHealthKits();
    GNextRescanTime = Now + RescanInterval;
  }
  for (const Kit of GHealthKits) {
    if (!Kit.Entity.IsValid()) {
      continue;
    }
    if (Kit.RespawnTime !== void 0) {
      if (Now < Kit.RespawnTime) {
        continue;
      }
      RespawnKit(Kit);
    }
    const Taker = FindKitTaker(Kit);
    if (Taker) {
      TakeKit(Kit, Taker, Now);
    } else if (IsModelEntity2(Kit.Entity)) {
      SpinKit(Kit, Kit.Entity, Now);
    } else if (bDebug) {
      Instance9.DebugSphere({ center: Kit.Entity.GetAbsOrigin(), radius: 12, duration: TickInterval * 2, color: DebugKitColor });
    }
  }
}
function ResetHealthKits() {
  for (const Kit of GHealthKits) {
    if (Kit.Entity.IsValid() && Kit.RespawnTime !== void 0) {
      SetKitVisible(Kit, true);
    }
    Kit.RespawnTime = void 0;
  }
  GNextRescanTime = 0;
}
function RescanHealthKits() {
  const Found = new Set(Instance9.FindEntitiesByName(HealthKitSettings.Name));
  for (const ClassName of KitClassNames) {
    for (const Ent of Instance9.FindEntitiesByClass(ClassName)) {
      if (Ent.GetEntityName().includes(HealthKitSettings.Name)) {
        Found.add(Ent);
      }
    }
  }
  const Known = /* @__PURE__ */ new Map();
  for (const Kit of GHealthKits) {
    Known.set(Kit.Entity, Kit);
  }
  const Kits = [];
  for (const Ent of Found) {
    if (!Ent.IsValid()) {
      continue;
    }
    const Existing = Known.get(Ent);
    if (Existing) {
      Kits.push(Existing);
    } else {
      Kits.push({ Entity: Ent, VisibleScale: IsModelEntity2(Ent) ? Ent.GetModelScale() : 1, BaseAngles: Ent.GetAbsAngles(), RespawnTime: void 0 });
    }
  }
  GHealthKits = Kits;
}
function FindKitTaker(Kit) {
  const KitPosition = Kit.Entity.GetAbsOrigin();
  let Taker = void 0;
  ForEachLivePawn((Pawn) => {
    if (Taker || Pawn.GetHealth() >= Pawn.GetMaxHealth()) {
      return;
    }
    const Feet = Pawn.GetAbsOrigin();
    const FlatDistance = Math.hypot(Feet.x - KitPosition.x, Feet.y - KitPosition.y);
    const Height = Feet.z - KitPosition.z;
    if (FlatDistance <= HealthKitSettings.PickupRadius && Height >= -PickupBelowTolerance && Height <= HealthKitSettings.PickupHeight) {
      Taker = Pawn;
    }
  });
  return Taker;
}
function TakeKit(Kit, Taker, Now) {
  const MaxHealth = Taker.GetMaxHealth();
  const OldHealth = Taker.GetHealth();
  const NewHealth = Math.min(MaxHealth, OldHealth + Math.ceil(MaxHealth * HealthKitSettings.HealFraction));
  Taker.SetHealth(NewHealth);
  SetKitVisible(Kit, false);
  Kit.RespawnTime = Now + HealthKitSettings.RespawnTime;
  SpawnKitFx(HealthKitSettings.PickupFxTemplate, Kit);
  if (bDebug) {
    const Name = Taker.GetPlayerController()?.GetPlayerName() ?? "someone";
    Instance9.Msg(`${LogPrefix} ${Name} took a health kit: ${OldHealth} -> ${NewHealth}`);
  }
}
function RespawnKit(Kit) {
  Kit.RespawnTime = void 0;
  SetKitVisible(Kit, true);
  SpawnKitFx(HealthKitSettings.RespawnFxTemplate, Kit);
}
function SpinKit(Kit, Model, Now) {
  if (HealthKitSettings.SpinDegreesPerSecond === 0) {
    return;
  }
  const Yaw = (Kit.BaseAngles.yaw + Now * HealthKitSettings.SpinDegreesPerSecond) % 360;
  Model.Move({ angles: { pitch: Kit.BaseAngles.pitch, yaw: Yaw, roll: Kit.BaseAngles.roll } });
}
function SetKitVisible(Kit, bVisible) {
  if (IsModelEntity2(Kit.Entity)) {
    Kit.Entity.SetModelScale(bVisible ? Kit.VisibleScale : HiddenScale);
  }
}
function SpawnKitFx(TemplateName, Kit) {
  if (TemplateName !== "") {
    SpawnTemporaryTemplate(TemplateName, Kit.Entity.GetAbsOrigin(), FxLifetime);
  }
}
function IsModelEntity2(Ent) {
  return "SetModelScale" in Ent && typeof Ent.SetModelScale === "function";
}

// src/bm_main.ts
var AirshotMinHeight = 64;
var ClassChatCommands = /* @__PURE__ */ new Map(
  [
    ["!demo", "demo" /* Demoman */],
    ["!medic", "medic" /* Medic */],
    ["!solider", "soldier" /* Solider */],
    ["!railer", "railer" /* Railer */],
    ["!none", "none" /* None */]
  ]
);
function Tick() {
  const Now = Instance10.GetGameTime();
  Instance10.SetNextThink(Now + TickInterval);
  const DeltaTime = Math.min(0.1, Math.max(0, Now - GLastThinkTime)) || TickInterval;
  GLastThinkTime = Now;
  try {
    TickMatch(Now);
    TickTimers(Now);
    for (const Definition of Object.values(ClassDefinitions)) {
      Definition.TickWorld(Now, DeltaTime);
    }
    ForEachLivePawn((Pawn, Slot) => {
      const PlayerClass = GClassBySlot.get(Slot);
      if (PlayerClass !== void 0) {
        const Definition = ClassDefinitions[PlayerClass];
        const FiredWeapon = TickLauncher(Pawn, Slot, Now);
        if (FiredWeapon === Definition.Settings.Primary) {
          Definition.OnPrimaryFire(Pawn, Slot, Now);
        } else if (FiredWeapon === Definition.Settings.Secondary) {
          Definition.OnSecondaryFire(Pawn, Slot, Now);
        }
        Definition.TickPlayer(Pawn, Slot, Now, DeltaTime);
      }
    });
    for (const Definition of Object.values(ClassDefinitions)) {
      Definition.TickWorldLate(Now, DeltaTime);
    }
    TickHealthKits(Now);
    TickClassMenuKey();
    TickPlayerHud();
    TickNoBuying();
    TickBots(Now);
  } catch (Exception) {
    Instance10.Msg(`${LogPrefix} error: ${String(Exception)}`);
  }
}
function BeginPlay() {
  Instance10.OnPlayerChat(HandlePlayerChat);
  Instance10.OnPlayerReset(HandlePlayerReset);
  Instance10.OnPlayerKill(HandlePlayerKill);
  Instance10.OnPlayerDisconnect(HandlePlayerDisconnect);
  Instance10.OnRoundStart(HandleRoundStart);
  Instance10.OnGunFire(HandleGunFire);
  Instance10.OnWeaponPickup(HandleWeaponPickup);
  Instance10.OnWeaponDrop(HandleWeaponDrop);
  Instance10.OnPlayerDamage(HandlePlayerDamage);
  Instance10.OnModifyPlayerDamage(HandleModifyPlayerDamage);
  Instance10.OnCustomHudClicked(HandleCustomHudClicked);
  Instance10.SetThink(Tick);
  Instance10.SetNextThink(Instance10.GetGameTime());
  Instance10.Msg(`${LogPrefix} loaded${bDebug ? " (DEBUG on)" : ""}`);
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
  if (Command === "!class") {
    OpenClassMenu(Player.GetPlayerSlot());
    return;
  }
  const PlayerClass = ClassChatCommands.get(Command);
  if (PlayerClass !== void 0) {
    RequestPlayerClass(Player, PlayerClass);
  }
}
function HandlePlayerReset(Event) {
  const Pawn = Event.player;
  const Slot = GetPlayerSlot(Pawn);
  if (Slot === INDEX_NONE) {
    return;
  }
  ClearPlayer(Slot);
  ResetBotMode(Slot);
  const bHadClass = GClassBySlot.has(Slot);
  ApplyPendingClass(Slot);
  RefreshClassUi(Pawn, Slot);
  const PlayerClass = GClassBySlot.get(Slot);
  SetTimer(0.1, () => {
    if (!Pawn.IsValid() || !Pawn.IsAlive()) {
      return;
    }
    if (PlayerClass === void 0) {
      if (bHadClass) {
        RestoreDefaultBody(Pawn);
      }
      GiveNoClassLoadout(Pawn);
    } else {
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
  ForgetBot(Event.playerSlot);
  ResetDamageNumbers(Event.playerSlot);
  ResetClassUi(Event.playerSlot);
  GClassBySlot.delete(Event.playerSlot);
  GPendingClassBySlot.delete(Event.playerSlot);
}
function HandleRoundStart() {
  for (const Definition of Object.values(ClassDefinitions)) {
    Definition.OnRoundStart();
  }
  ClearDecals();
  ResetHealthKits();
  ApplyMatchSettings();
  Instance10.Msg(`${LogPrefix} match settings applied`);
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
  if (IsWeapon(Weapon, Definition.Settings.Primary) && !Definition.Settings.PrimaryLauncher) {
    Definition.OnPrimaryFire(Pawn, Slot, Instance10.GetGameTime());
  } else if (IsWeapon(Weapon, Definition.Settings.Secondary) && !Definition.Settings.SecondaryLauncher) {
    Definition.OnSecondaryFire(Pawn, Slot, Instance10.GetGameTime());
  }
}
function HandleWeaponPickup(Event) {
  const Weapon = Event.weapon;
  SetTimer(0, () => {
    RemoveIfNotAllowed(Weapon);
  });
}
function HandleWeaponDrop(Event) {
  const Weapon = Event.weapon;
  const Dropper = Event.dropper;
  SetTimer(0, () => {
    RemoveDeathDrop(Weapon, Dropper);
  });
}
function HandlePlayerDamage(Event) {
  const AttackerSlot = GetPlayerSlot(Event.attacker);
  if (AttackerSlot === INDEX_NONE || Event.attacker === Event.player) {
    return;
  }
  ShowDamageNumber(AttackerSlot, Event.damage);
  if (GetHeightAboveGround(Event.player, AirshotMinHeight) >= AirshotMinHeight) {
    ShowAirshot(AttackerSlot);
  }
}
function HandleCustomHudClicked(Event) {
  const Choice = ReadClassMenuClick(Event.layout, Event.buttonId);
  if (Choice === void 0) {
    return;
  }
  CloseClassMenu(Event.player.GetPlayerSlot());
  if (Choice !== "close") {
    RequestPlayerClass(Event.player, Choice);
  }
}
function HandleModifyPlayerDamage(Event) {
  for (const Definition of Object.values(ClassDefinitions)) {
    const Result = Definition.ModifyAnyDamage(Event);
    if (Result) {
      return Result;
    }
  }
  if ((Event.damageTypes & CSDamageTypes3.FALL) !== 0 && GClassBySlot.has(GetPlayerSlot(Event.player))) {
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
var GPendingClassBySlot = /* @__PURE__ */ new Map();
var GLastThinkTime = 0;
function ApplyMatchSettings() {
  const Commands = [];
  Commands.push(`mp_teammates_are_enemies ${bFriendlyFire ? 1 : 0}`, `mp_friendlyfire ${bFriendlyFire ? 1 : 0}`);
  if (bDebug) {
    Commands.push("mp_do_warmup_period 0", "mp_warmuptime 0", "mp_freezetime 0");
    Commands.push("mp_roundtime 60", "mp_roundtime_defuse 60", "mp_roundtime_hostage 60");
    Commands.push("mp_ignore_round_win_conditions 1", "mp_respawn_on_death_t 1", "mp_respawn_on_death_ct 1");
    Commands.push("sv_infinite_ammo 1");
    Commands.push("bot_quota_mode fill", "bot_quota 8", "bot_join_team any", "bot_stop 1");
  }
  for (const Command of Commands) {
    Instance10.ServerCommand(Command);
  }
}
function TickMatch(Now) {
  if (bDebug && Instance10.IsWarmupPeriod()) {
    Instance10.ServerCommand("mp_warmup_end");
  }
}
function RequestPlayerClass(Player, PlayerClass) {
  const Slot = Player.GetPlayerSlot();
  const CurrentClass = GClassBySlot.get(Slot) ?? "none" /* None */;
  const Pawn = Player.GetPlayerPawn();
  const bAlive = Pawn !== void 0 && Pawn.IsValid() && Pawn.IsAlive();
  if (!bAlive || CurrentClass === "none" /* None */) {
    GPendingClassBySlot.delete(Slot);
    SetPlayerClass(Player, PlayerClass);
    return;
  }
  if (PlayerClass === CurrentClass) {
    GPendingClassBySlot.delete(Slot);
  } else {
    GPendingClassBySlot.set(Slot, PlayerClass);
  }
  ShowClassIndicator(Slot, CurrentClass, Pawn?.GetTeamNumber() === 2);
  Instance10.Msg(`${LogPrefix} ${Player.GetPlayerName()} -> ${PlayerClass} on respawn`);
}
function ApplyPendingClass(Slot) {
  const NextClass = GPendingClassBySlot.get(Slot);
  if (NextClass === void 0) {
    return;
  }
  GPendingClassBySlot.delete(Slot);
  if (NextClass === "none" /* None */) {
    GClassBySlot.delete(Slot);
  } else {
    GClassBySlot.set(Slot, NextClass);
  }
}
function SetPlayerClass(Player, PlayerClass) {
  const Slot = Player.GetPlayerSlot();
  ClearPlayer(Slot);
  const Pawn = Player.GetPlayerPawn();
  if (PlayerClass === "none" /* None */) {
    GClassBySlot.delete(Slot);
    if (Pawn && Pawn.IsAlive()) {
      RestoreDefaultBody(Pawn);
      GiveNoClassLoadout(Pawn);
    }
  } else {
    GClassBySlot.set(Slot, PlayerClass);
    if (Pawn && Pawn.IsAlive()) {
      GiveLoadout(Pawn, PlayerClass);
    }
  }
  ShowClassIndicator(Slot, PlayerClass, Pawn?.GetTeamNumber() === 2);
  const ClassLabel = PlayerClass === "none" /* None */ ? "normal" : PlayerClass;
  Instance10.Msg(`${LogPrefix} ${Player.GetPlayerName()} -> ${ClassLabel}`);
}
function RefreshClassUi(Pawn, Slot) {
  const Controller = Pawn.GetPlayerController();
  if (!Controller || Controller.IsBot()) {
    return;
  }
  const PlayerClass = GClassBySlot.get(Slot) ?? "none" /* None */;
  ShowClassIndicator(Slot, PlayerClass, Pawn?.GetTeamNumber() === 2);
  SetTimer(0.5, () => {
    if (Pawn.IsValid() && Pawn.IsAlive()) {
      OfferClassMenu(Slot, GClassBySlot.get(Slot) ?? "none" /* None */);
    }
  });
}
function ClearPlayer(Slot) {
  for (const Definition of Object.values(ClassDefinitions)) {
    Definition.ClearPlayer(Slot);
  }
  ClearLauncher(Slot);
  ShowAmmo(Slot, void 0);
  ShowHealth(Slot, void 0);
  ShowCounter(Slot, void 0);
}
function TickPlayerHud() {
  ForEachLivePawn((Pawn, Slot) => {
    const Controller = Pawn.GetPlayerController();
    if (Controller && !Controller.IsBot()) {
      const PlayerClass = GClassBySlot.get(Slot);
      ShowHealth(Slot, Pawn);
      ShowAmmo(Slot, GetLauncherAmmo(Pawn, Slot));
      ShowCounter(Slot, PlayerClass !== void 0 ? ClassDefinitions[PlayerClass].GetHudCounter(Slot) : void 0);
    }
  });
}
function RemoveIfNotAllowed(Weapon) {
  if (!Weapon.IsValid()) {
    return;
  }
  const Pawn = Weapon.GetOwner();
  const Slot = GetPlayerSlot(Pawn);
  if (!Pawn || Slot === INDEX_NONE || !Pawn.IsAlive()) {
    return;
  }
  const PlayerClass = GClassBySlot.get(Slot) ?? "none" /* None */;
  if (IsWeaponAllowed(PlayerClass, Weapon)) {
    return;
  }
  Pawn.DestroyWeapon(Weapon);
  SetTimer(0, () => {
    EnsureWeaponInHand(Pawn);
  });
}
function RemoveDeathDrop(Weapon, Dropper) {
  if (!Weapon.IsValid() || Weapon.GetOwner()) {
    return;
  }
  if (Dropper.IsValid() && Dropper.IsAlive()) {
    return;
  }
  Weapon.Remove();
}
function EnsureWeaponInHand(Pawn) {
  if (!Pawn.IsValid() || !Pawn.IsAlive()) {
    return;
  }
  const Active = Pawn.GetActiveWeapon();
  if (Active && Active.IsValid()) {
    return;
  }
  for (const GearSlot of [CSGearSlot2.RIFLE, CSGearSlot2.PISTOL, CSGearSlot2.KNIFE]) {
    const Weapon = Pawn.FindWeaponBySlot(GearSlot);
    if (Weapon) {
      Pawn.SwitchToWeapon(Weapon);
      return;
    }
  }
}
function TickNoBuying() {
  ForEachLivePawn((Pawn) => {
    const Controller = Pawn.GetPlayerController();
    if (!Controller) {
      return;
    }
    const Money = Controller.GetMoneySpendableNow();
    if (Money > 0) {
      Controller.AddMoneySpendableNow(-Money);
    }
  });
}
