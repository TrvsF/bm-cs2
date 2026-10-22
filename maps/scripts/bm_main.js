// src/bm_main.ts
import { Instance as Instance11, CSDamageTypes as CSDamageTypes3, CSDamageFlags as CSDamageFlags3, CSGearSlot as CSGearSlot2 } from "cs_script/point_script";

// src/bm_core.ts
import { Instance } from "cs_script/point_script";
var bDebug = false;
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
var GbFriendlyFire = false;
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
function SetFriendlyFire(bFriendlyFire) {
  GbFriendlyFire = bFriendlyFire;
}
function IsFriendlyFire() {
  return GbFriendlyFire;
}
var VectorMath = class _VectorMath {
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
  static Dot(A, B) {
    return A.x * B.x + A.y * B.y + A.z * B.z;
  }
  static GetSafeNormal(V) {
    const Length = Math.hypot(V.x, V.y, V.z) || 1;
    return { x: V.x / Length, y: V.y / Length, z: V.z / Length };
  }
  static ProjectOnPlane(V, PlaneNormal) {
    return _VectorMath.Subtract(V, _VectorMath.Scale(PlaneNormal, _VectorMath.Dot(V, PlaneNormal)));
  }
  static GetForwardVector(Rotation) {
    const Pitch = Rotation.pitch * Math.PI / 180;
    const Yaw = Rotation.yaw * Math.PI / 180;
    return { x: Math.cos(Pitch) * Math.cos(Yaw), y: Math.cos(Pitch) * Math.sin(Yaw), z: -Math.sin(Pitch) };
  }
  static GetRotation(Direction, Roll = 0) {
    const Normal = _VectorMath.GetSafeNormal(Direction);
    const Pitch = -Math.asin(Math.max(-1, Math.min(1, Normal.z))) * 180 / Math.PI;
    const Yaw = Math.atan2(Normal.y, Normal.x) * 180 / Math.PI;
    return { pitch: Pitch, yaw: Yaw, roll: Roll };
  }
};
var RotationMath = class _RotationMath {
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
  static Inverse(Matrix) {
    const F = Matrix.Forward;
    const L = Matrix.Left;
    const U = Matrix.Up;
    const Result = {
      Forward: { x: F.x, y: L.x, z: U.x },
      Left: { x: F.y, y: L.y, z: U.y },
      Up: { x: F.z, y: L.z, z: U.z }
    };
    return Result;
  }
  static Multiply(A, B) {
    const Result = {
      Forward: _RotationMath.RotateVector(A, B.Forward),
      Left: _RotationMath.RotateVector(A, B.Left),
      Up: _RotationMath.RotateVector(A, B.Up)
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
  return VectorMath.Add(Pawn.GetAbsOrigin(), ChestOffset);
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
  const Away = VectorMath.GetSafeNormal(VectorMath.Subtract(Chest, ExplosionOrigin));
  const Behind = Instance2.TraceLine(
    {
      start: Chest,
      end: VectorMath.Add(Chest, VectorMath.Scale(Away, BloodSplatterDistance)),
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
      end: VectorMath.Add(Chest, VectorMath.Scale(UpVector, -BloodSplatterDistance)),
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
  const Spawned = Template.ForceSpawn(Start, VectorMath.GetRotation(VectorMath.Subtract(End, Start)));
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
function SpawnHeldBeam(TemplateName, EndMarkerName, Start, End, FallbackColor) {
  const Template = Instance2.FindEntityByName(TemplateName);
  const Entities = IsPointTemplate(Template) ? Template.ForceSpawn(Start, VectorMath.GetRotation(VectorMath.Subtract(End, Start))) ?? [] : [];
  const Beam = { Entities, EndMarkerName, FallbackColor };
  PlaceHeldBeam(Beam, Start, End, true);
  return Beam;
}
function MoveHeldBeam(Beam, Start, End) {
  PlaceHeldBeam(Beam, Start, End, false);
}
function RemoveHeldBeam(Beam) {
  RemoveEntities(Beam.Entities);
}
function PlaceHeldBeam(Beam, Start, End, bTeleport) {
  if (Beam.Entities.length === 0) {
    Instance2.DebugLine({ start: Start, end: End, duration: TickInterval * 2, color: Beam.FallbackColor });
    return;
  }
  const Angles = VectorMath.GetRotation(VectorMath.Subtract(End, Start));
  for (const Ent of Beam.Entities) {
    if (!Ent.IsValid()) {
      continue;
    }
    const bEndMarker = Ent.GetEntityName().startsWith(Beam.EndMarkerName);
    if (!bEndMarker && Ent.GetParent() !== void 0) {
      continue;
    }
    const Placement = bEndMarker ? { position: End } : { position: Start, angles: Angles };
    if (bTeleport) {
      Ent.Teleport(Placement);
    } else {
      Ent.Move(Placement);
    }
  }
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
  const Rotation = VectorMath.GetRotation(VectorMath.Scale(SurfaceNormal, -1), Math.random() * 360);
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
        end: VectorMath.Add(Position, VectorMath.Scale(Direction, MaxDistance)),
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
var StandingKnockbackHeight = 82;
var CrouchedKnockbackHeight = 62;
var AirborneSelfKnockbackScale = 1.33;
var SelfBlastDamageScale = 0.33;
var ExplosionDebugColor = { r: 255, g: 140, b: 0 };
var MaxHitscanTraces = 8;
var GroundTraceLift = { x: 0, y: 0, z: 2 };
var SurfaceGap = 2;
var MinGroundNormalZ = 0.7;
var GroundProbeDistance = 8;
var MinFacingSpeed = 1;
function LaunchProjectile(Owner, Speed, UpSpeed, GravityScale, TemplateName) {
  const Direction = VectorMath.GetForwardVector(Owner.GetEyeAngles());
  const Start = VectorMath.Add(Owner.GetEyePosition(), ProjectileLaunchOffset);
  const Velocity = VectorMath.Add(VectorMath.Scale(Direction, Speed), { x: 0, y: 0, z: UpSpeed });
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
  const Hit = SweepProjectile(Projectile, DeltaTime, bHitPlayers);
  PlaceProjectileModels(Projectile, false);
  return Hit;
}
function MoveBouncingProjectile(Projectile, DeltaTime, bHitPlayers, Bounce) {
  if (Projectile.GroundNormal) {
    return RollProjectile(Projectile, Projectile.GroundNormal, DeltaTime, bHitPlayers, Bounce);
  }
  const Hit = MoveProjectile(Projectile, DeltaTime, bHitPlayers);
  if (!Hit) {
    return void 0;
  }
  if (IsPlayerPawn(Hit.hitEntity)) {
    return Hit.hitEntity;
  }
  BounceProjectile(Projectile, Hit.normal, Bounce);
  return void 0;
}
function RollProjectile(Projectile, Ground, DeltaTime, bHitPlayers, Bounce) {
  const Pull = { x: 0, y: 0, z: -Gravity * Projectile.GravityScale * DeltaTime };
  const Rolling = VectorMath.ProjectOnPlane(VectorMath.Add(Projectile.Velocity, Pull), Ground);
  const Speed = VectorMath.Size(Rolling);
  const SlowedSpeed = Math.max(0, Speed - Bounce.RollFriction * DeltaTime);
  Projectile.Velocity = Speed > 0 ? VectorMath.Scale(Rolling, SlowedSpeed / Speed) : ZeroVector;
  const Hit = SlowedSpeed > 0 ? SweepProjectile(Projectile, DeltaTime, bHitPlayers) : void 0;
  if (Hit && IsPlayerPawn(Hit.hitEntity)) {
    PlaceProjectileModels(Projectile, false);
    return Hit.hitEntity;
  }
  if (Hit) {
    BounceProjectile(Projectile, Hit.normal, Bounce);
  }
  FollowGround(Projectile);
  PlaceProjectileModels(Projectile, false);
  return void 0;
}
function BounceProjectile(Projectile, Normal, Bounce) {
  Projectile.bTouchedWorld = true;
  const IntoSpeed = -VectorMath.Dot(Projectile.Velocity, Normal);
  if (IntoSpeed <= 0) {
    return;
  }
  const Along = VectorMath.Scale(VectorMath.ProjectOnPlane(Projectile.Velocity, Normal), 1 - Bounce.ImpactFriction);
  const OutSpeed = IntoSpeed * Bounce.Restitution;
  if (Normal.z >= MinGroundNormalZ && OutSpeed < Bounce.SettleSpeed) {
    Projectile.GroundNormal = Normal;
    Projectile.Velocity = Along;
    return;
  }
  Projectile.Velocity = VectorMath.Add(Along, VectorMath.Scale(Normal, OutSpeed));
}
function FollowGround(Projectile) {
  if (!Projectile.GroundNormal) {
    return;
  }
  const Trace = Instance3.TraceLine(
    {
      start: Projectile.Position,
      end: VectorMath.Add(Projectile.Position, { x: 0, y: 0, z: -(SurfaceGap + GroundProbeDistance) }),
      ignoreEntity: GetIgnoredEntities(Projectile),
      ignorePlayers: true
    }
  );
  if (!Trace.didHit || Trace.normal.z < MinGroundNormalZ) {
    Projectile.GroundNormal = void 0;
    return;
  }
  Projectile.Position = VectorMath.Add(Trace.end, VectorMath.Scale(Trace.normal, SurfaceGap));
  Projectile.GroundNormal = Trace.normal;
  Projectile.Velocity = VectorMath.ProjectOnPlane(Projectile.Velocity, Trace.normal);
}
function SweepProjectile(Projectile, DeltaTime, bHitPlayers) {
  const NextPosition = VectorMath.Add(Projectile.Position, VectorMath.Scale(Projectile.Velocity, DeltaTime));
  const Trace = Instance3.TraceLine(
    {
      start: Projectile.Position,
      end: NextPosition,
      ignoreEntity: GetIgnoredEntities(Projectile),
      ignorePlayers: !bHitPlayers
    }
  );
  if (Trace.didHit) {
    Projectile.Position = VectorMath.Add(Trace.end, VectorMath.Scale(Trace.normal, SurfaceGap));
  } else {
    Projectile.Position = NextPosition;
  }
  return Trace.didHit ? Trace : void 0;
}
function GetIgnoredEntities(Projectile) {
  const IgnoredEntities = [Projectile.Owner];
  for (const Model of Projectile.Models) {
    if (Model.Ent.IsValid()) {
      IgnoredEntities.push(Model.Ent);
    }
  }
  return IgnoredEntities;
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
    Models.push({ Ent, LocalRotation: RotationMath.FromRotator(Ent.GetAbsAngles()) });
  }
  return Models;
}
function PlaceProjectileModels(Projectile, bTeleport) {
  const bTurn = VectorMath.Size(Projectile.Velocity) >= MinFacingSpeed;
  const Flight = RotationMath.FromRotator(VectorMath.GetRotation(Projectile.Velocity));
  for (const Model of Projectile.Models) {
    if (!Model.Ent.IsValid() || Model.Ent.GetParent() !== void 0) {
      continue;
    }
    const Placement = { position: Projectile.Position };
    if (bTurn) {
      Placement.angles = RotationMath.ToRotator(RotationMath.Multiply(Flight, Model.LocalRotation));
    }
    if (bTeleport) {
      Model.Ent.Teleport(Placement);
    } else {
      Model.Ent.Move(Placement);
    }
  }
}
function Explode(Position, Attacker, Radius, Damage, Knockback, RangeFalloff) {
  const Origin = VectorMath.Add(Position, ExplosionOffset);
  if (!SpawnTemporaryTemplate(ExplosionTemplateName, Origin, ExplosionFxLifetime)) {
    Instance3.DebugSphere({ center: Origin, radius: Radius, duration: 0.3, color: ExplosionDebugColor });
  }
  SpawnScorchMark(Position);
  if (!Attacker.IsValid()) {
    return;
  }
  ForEachLivePawn((Victim) => {
    const Target = GetChestPosition(Victim);
    const Offset = VectorMath.Subtract(Target, Origin);
    const Distance = VectorMath.Size(Offset);
    if (Distance > Radius) {
      return;
    }
    const Trace = Instance3.TraceLine({ start: Origin, end: Target, ignorePlayers: true });
    if (Trace.didHit && !Trace.startedInSolid) {
      return;
    }
    const bIsSelf = Victim === Attacker;
    if (!bIsSelf && !IsFriendlyFire() && Victim.GetTeamNumber() === Attacker.GetTeamNumber()) {
      return;
    }
    const Falloff = 1 - 0.5 * (Distance / Radius);
    const RangeScale = bIsSelf ? 1 : GetRangeDamageScale(Attacker, Victim, RangeFalloff);
    const BlastDamage = Damage * Falloff * RangeScale;
    const Away = Distance > 1 ? Offset : UpVector;
    const Push = ApplyKnockback(Victim, Away, BlastDamage, Knockback, bIsSelf);
    const DamageTaken = bIsSelf ? BlastDamage * SelfBlastDamageScale : BlastDamage;
    const DamageDealt = Victim.TakeDamage(
      {
        damage: DamageTaken,
        damageTypes: CSDamageTypes.BLAST,
        attacker: Attacker,
        inflictor: Attacker
      }
    );
    if (!bIsSelf && DamageDealt > 0) {
      SpawnBloodSplatter(Origin, Victim);
    }
    const PushDirection = VectorMath.GetSafeNormal(Push);
    Instance3.Msg(`${LogPrefix} ${Attacker.GetPlayerController()?.GetPlayerName()} Damaged ${Victim.GetPlayerController()?.GetPlayerName()} : ${DamageTaken}d : ${VectorMath.Size(Push)}k (${PushDirection.x}, ${PushDirection.y}, ${PushDirection.z}) : ${Falloff}f : ${RangeScale.toFixed(2)}r`);
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
  const Distance = VectorMath.Size(VectorMath.Subtract(GetChestPosition(Victim), GetChestPosition(Attacker)));
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
    if (!Victim.IsAlive() || !IsFriendlyFire() && Victim.GetTeamNumber() === Shooter.GetTeamNumber()) {
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
  return VectorMath.GetForwardVector(
    {
      pitch: Aim.pitch + Radius * Math.sin(Around),
      yaw: Aim.yaw + Radius * Math.cos(Around),
      roll: 0
    }
  );
}
function ApplyKnockback(Victim, Direction, Damage, Strength, bIsSelf) {
  const bOnGround = Victim.GetGroundEntity() !== void 0;
  const bCrouched = Victim.IsDucking() || Victim.IsDucked();
  let Push = VectorMath.GetSafeNormal(Direction);
  if (bOnGround) {
    Push = VectorMath.GetSafeNormal(VectorMath.Add(Push, GroundedKnockbackLift));
  }
  let Scale = Strength;
  if (bIsSelf && !bOnGround) {
    Scale *= AirborneSelfKnockbackScale;
  }
  const Speed = Damage * Scale / (bCrouched ? CrouchedKnockbackHeight : StandingKnockbackHeight);
  if (Speed === 0) {
    return ZeroVector;
  }
  const Velocity = VectorMath.Scale(Push, Speed);
  Victim.Teleport({ velocity: VectorMath.Add(Victim.GetAbsVelocity(), Velocity) });
  return Velocity;
}
function GetHeightAboveGround(Pawn, MaxDistance) {
  if (Pawn.GetGroundEntity()) {
    return 0;
  }
  const Start = VectorMath.Add(Pawn.GetAbsOrigin(), GroundTraceLift);
  const Trace = Instance3.TraceLine(
    {
      start: Start,
      end: VectorMath.Add(Start, { x: 0, y: 0, z: -(MaxDistance + GroundTraceLift.z) }),
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
  const BulletTravel = VectorMath.Size(VectorMath.Subtract(GetChestPosition(Event.player), Attacker.GetEyePosition()));
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
var ReloadFxLifetime = 3;
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
      ReloadStartTime: 0,
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
      const Ammo = {
        Clip: State.Clip,
        MaxClip: State.MaxClip,
        bReloading: State.NextReloadTime !== void 0,
        ChargeFraction: GetChargeFraction(State),
        ReloadFraction: GetReloadFraction(State)
      };
      return Ammo;
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
function GetReloadFraction(State) {
  if (State.NextReloadTime === void 0) {
    return 0;
  }
  return GetWaitFraction(State.ReloadStartTime, State.NextReloadTime, Instance4.GetGameTime());
}
function GetWaitFraction(WaitStart, ReadyTime, Now) {
  if (Now >= ReadyTime || ReadyTime <= WaitStart) {
    return 1;
  }
  return Math.max(0, (Now - WaitStart) / (ReadyTime - WaitStart));
}
function TickReload(Pawn, State, Now) {
  if (!CanReload(State)) {
    State.NextReloadTime = void 0;
    return;
  }
  if (State.NextReloadTime === void 0) {
    State.ReloadStartTime = Math.max(Now, State.NextFireTime);
    State.NextReloadTime = State.ReloadStartTime + State.Settings.ReloadFirstTime;
    return;
  }
  if (Now < State.NextReloadTime) {
    return;
  }
  State.Clip = State.Settings.ReloadEachTime > 0 ? State.Clip + 1 : State.Settings.ClipSize;
  SpawnReloadFx(Pawn, State.Settings);
  State.ReloadStartTime = Now;
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
function SpawnReloadFx(Pawn, Settings) {
  if (Settings.ReloadFxTemplate === "") {
    return;
  }
  const Spawned = SpawnTemporaryTemplate(Settings.ReloadFxTemplate, Pawn.GetEyePosition(), ReloadFxLifetime) ?? [];
  for (const Ent of Spawned) {
    if (Ent.GetParent() === void 0) {
      Ent.SetParent(Pawn);
    }
  }
}

// src/bm_classes.ts
var EPlayerClass = /* @__PURE__ */ ((EPlayerClass2) => {
  EPlayerClass2["None"] = "none";
  EPlayerClass2["Demoman"] = "demo";
  EPlayerClass2["Solider"] = "soldier";
  EPlayerClass2["Medic"] = "medic";
  EPlayerClass2["Railer"] = "railer";
  EPlayerClass2["Beamer"] = "beamer";
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
var BeamerBeamFalloff = [
  { Distance: 0, Scale: 1 },
  { Distance: 512, Scale: 0.5 },
  { Distance: 1200, Scale: 0.2 }
];
var BeamerShotgunFalloff = [
  { Distance: 0, Scale: 1 },
  { Distance: 256, Scale: 1 },
  { Distance: 1024, Scale: 0.3 }
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
    FireFxTemplate: "rocket_fire_template",
    ReloadFxTemplate: "rocket_reload_template"
  },
  SecondaryLauncher: void 0,
  RocketDamage: 90,
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
    FireFxTemplate: "sticky_fire_template",
    ReloadFxTemplate: "sticky_reload_template"
  },
  SecondaryLauncher: {
    FireInterval: 0.6,
    ClipSize: 4,
    ReloadFirstTime: 1.24,
    ReloadEachTime: 0.6,
    ChargeTime: 0,
    FireFxTemplate: "pipe_fire_template",
    ReloadFxTemplate: "pipe_reload_template"
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
  PipeDamage: 75,
  PipeRolledDamageScale: 0.6,
  PipeKnockback: 1e3,
  PipeFalloff: TF2RocketFalloff,
  PipeFuseTime: 1.6,
  PipeBounce: {
    Restitution: 0.2,
    ImpactFriction: 0.5,
    RollFriction: 1200,
    SettleSpeed: 100
  }
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
    FireFxTemplate: "rail_shot_fire_template",
    ReloadFxTemplate: "rail_shot_reload_template"
  },
  SecondaryLauncher: {
    FireInterval: 0.5,
    ClipSize: 1,
    ReloadFirstTime: 3,
    ReloadEachTime: 3,
    ChargeTime: 1,
    FireFxTemplate: "rail_fire_template",
    ReloadFxTemplate: "rail_reload_template"
  },
  PPsh: {
    Damage: 7,
    HeadshotMultiplier: 1,
    Range: 4096,
    Spread: 2,
    Pellets: 1,
    bPierces: false,
    Falloff: RailerShotFalloff,
    Knockback: 400,
    SelfKnockback: 200,
    bBloodSplatter: false,
    bHeldBeam: false,
    BeamTemplate: "rail_tracer_template",
    BeamEndName: "rail_tracer_end",
    BeamLifetime: 0.06,
    ImpactTemplate: "",
    ImpactLifetime: 0
  },
  Railgun: {
    Damage: 110,
    HeadshotMultiplier: 1.5,
    Range: 8192,
    Spread: 0,
    Pellets: 1,
    bPierces: true,
    Falloff: RailerBeamFalloff,
    Knockback: 333,
    SelfKnockback: 333,
    bBloodSplatter: true,
    bHeldBeam: false,
    BeamTemplate: "rail_beam_template",
    BeamEndName: "rail_beam_end",
    BeamLifetime: 0.4,
    ImpactTemplate: "rail_impact_template",
    ImpactLifetime: 2
  }
};
var BeamerSettings = {
  DisplayName: "Beamer",
  Primary: "weapon_negev",
  Secondary: "weapon_elite",
  Melee: "",
  Health: 200,
  SizeScale: 1.4,
  PrimaryLauncher: {
    FireInterval: 0.05,
    ClipSize: 100,
    ReloadFirstTime: 2.5,
    ReloadEachTime: 0,
    ChargeTime: 0,
    FireFxTemplate: "",
    ReloadFxTemplate: "beamer_beam_reload_template"
  },
  SecondaryLauncher: {
    FireInterval: 0.3,
    ClipSize: 2,
    ReloadFirstTime: 1.4,
    ReloadEachTime: 0,
    ChargeTime: 0,
    FireFxTemplate: "beamer_shot_fire_template",
    ReloadFxTemplate: "beamer_shot_reload_template"
  },
  EnergyBeam: {
    Damage: 5,
    HeadshotMultiplier: 1,
    Range: 2048,
    Spread: 0,
    Pellets: 1,
    bPierces: false,
    Falloff: BeamerBeamFalloff,
    Knockback: 0,
    SelfKnockback: 0,
    bBloodSplatter: false,
    bHeldBeam: true,
    BeamTemplate: "beamer_beam_template",
    BeamEndName: "beamer_beam_end",
    BeamLifetime: 0,
    ImpactTemplate: "",
    ImpactLifetime: 0
  },
  Shotgun: {
    Damage: 10,
    HeadshotMultiplier: 1,
    Range: 2048,
    Spread: 6,
    Pellets: 10,
    bPierces: false,
    Falloff: BeamerShotgunFalloff,
    Knockback: 600,
    SelfKnockback: 200,
    bBloodSplatter: false,
    bHeldBeam: false,
    BeamTemplate: "beamer_shot_tracer_template",
    BeamEndName: "beamer_shot_tracer_end",
    BeamLifetime: 0.06,
    ImpactTemplate: "",
    ImpactLifetime: 0
  }
};
var PlayableClasses = Object.values(EPlayerClass).filter((PlayerClass2) => {
  return PlayerClass2 !== "none" /* None */;
});
var StickyTemplateName = "sticky_template";
var RocketTemplateName = "rocket_template";
var PipeTemplateName = "pipe_template";
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
var PlayerClass = class {
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
var SoldierClass = class extends PlayerClass {
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
var DemomanClass = class extends PlayerClass {
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
    const Pipe = {
      ...LaunchProjectile(Pawn, this.Settings.PipeLaunchSpeed, this.Settings.PipeLaunchUp, 1, PipeTemplateName),
      bTouchedWorld: false,
      GroundNormal: void 0
    };
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
    if (!Pipe.Owner.IsValid()) {
      DestroyProjectile(Pipe);
      return false;
    }
    if (Now - Pipe.SpawnedAt >= this.Settings.PipeFuseTime || MoveBouncingProjectile(Pipe, DeltaTime, !Pipe.bTouchedWorld, this.Settings.PipeBounce)) {
      this.DetonatePipe(Pipe);
      return false;
    }
    if (Pipe.Models.length === 0) {
      Instance5.DebugSphere({ center: Pipe.Position, radius: 3, duration: TickInterval * 2, color: GetTeamColor(Pipe.Owner) });
    }
    return true;
  }
  DetonatePipe(Pipe) {
    DestroyProjectile(Pipe);
    const Damage = this.Settings.PipeDamage * (Pipe.bTouchedWorld ? this.Settings.PipeRolledDamageScale : 1);
    Explode(Pipe.Position, Pipe.Owner, this.Settings.PipeRadius, Damage, this.Settings.PipeKnockback, this.Settings.PipeFalloff);
  }
};
var MedicClass = class extends PlayerClass {
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
          start: VectorMath.Subtract(Pawn.GetEyePosition(), BeamStartDrop),
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
    if (VectorMath.Size(VectorMath.Subtract(TargetChest, EyePosition)) > this.Settings.BreakRange) {
      return false;
    }
    return !Instance5.TraceLine({ start: EyePosition, end: TargetChest, ignorePlayers: true }).didHit;
  }
  AcquireHealTarget(Medic) {
    const EyePosition = Medic.GetEyePosition();
    const Forward = VectorMath.GetForwardVector(Medic.GetEyeAngles());
    const End = VectorMath.Add(EyePosition, VectorMath.Scale(Forward, this.Settings.Range));
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
var RailerClass = class extends PlayerClass {
  constructor() {
    super(RailerSettings);
  }
  OnPrimaryFire(Pawn, Slot, Now) {
    FireBeamWeapon(Pawn, this.Settings.PPsh, Pawn.FindWeapon(this.Settings.Primary));
  }
  OnSecondaryFire(Pawn, Slot, Now) {
    FireBeamWeapon(Pawn, this.Settings.Railgun, Pawn.FindWeapon(this.Settings.Secondary));
  }
};
function FireBeamWeapon(Shooter, Settings, Weapon) {
  const Start = Shooter.GetEyePosition();
  const Aim = Shooter.GetEyeAngles();
  for (let Pellet = 0; Pellet < Settings.Pellets; Pellet++) {
    const Direction = GetSpreadDirection(Aim, Settings.Spread);
    const Result = TraceBeamWeapon(Shooter, Settings, Start, Direction);
    for (const Hit of Result.Hits) {
      const Distance = GetHitDistance(Hit, Start);
      const RangeScale = EvaluateDamageCurve(Settings.Falloff, Distance);
      const bHeadshot = Hit.Trace.hitGroup === CSHitGroup.HEAD;
      const Damage = Settings.Damage * RangeScale * (bHeadshot ? Settings.HeadshotMultiplier : 1);
      ApplyKnockback(Hit.Victim, Direction, Damage, Settings.Knockback, false);
      if (DealShockDamage(Shooter, Hit.Victim, Damage, Weapon) > 0 && Settings.bBloodSplatter) {
        SpawnBloodSplatter(Start, Hit.Victim);
      }
    }
    if (!Settings.bHeldBeam) {
      SpawnBeam(Settings.BeamTemplate, Settings.BeamEndName, VectorMath.Subtract(Start, BeamStartDrop), Result.End, Settings.BeamLifetime, GetTeamColor(Shooter));
    }
    if (Settings.ImpactTemplate !== "") {
      SpawnTemporaryTemplate(Settings.ImpactTemplate, Result.End, Settings.ImpactLifetime);
    }
  }
  const Backwards = VectorMath.Scale(VectorMath.GetForwardVector(Aim), -1);
  ApplyKnockback(Shooter, Backwards, Settings.Damage * Settings.Pellets, Settings.SelfKnockback, true);
}
function TraceBeamWeapon(Shooter, Settings, Start, Direction) {
  const MaxHits = Settings.bPierces ? MaxBeamHits : 1;
  return TraceHitscan(Shooter, Start, VectorMath.Add(Start, VectorMath.Scale(Direction, Settings.Range)), MaxHits);
}
function GetHitDistance(Hit, Start) {
  return VectorMath.Size(VectorMath.Subtract(Hit.Trace.end, Start));
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
var BeamerClass = class extends PlayerClass {
  PlayerStates = /* @__PURE__ */ new Map();
  constructor() {
    super(BeamerSettings);
  }
  OnPrimaryFire(Pawn, Slot, Now) {
    FireBeamWeapon(Pawn, this.Settings.EnergyBeam, Pawn.FindWeapon(this.Settings.Primary));
    this.GetPlayerState(Slot).LastBeamTime = Now;
  }
  OnSecondaryFire(Pawn, Slot, Now) {
    FireBeamWeapon(Pawn, this.Settings.Shotgun, Pawn.FindWeapon(this.Settings.Secondary));
  }
  TickPlayer(Pawn, Slot, Now, DeltaTime) {
    const State = this.PlayerStates.get(Slot);
    if (!State) {
      return;
    }
    if (!this.IsBeamOn(Pawn, State, Now)) {
      this.StopBeam(State);
      return;
    }
    const Beam = this.Settings.EnergyBeam;
    const Start = Pawn.GetEyePosition();
    const End = TraceBeamWeapon(Pawn, Beam, Start, VectorMath.GetForwardVector(Pawn.GetEyeAngles())).End;
    const BeamStart = VectorMath.Subtract(Start, BeamStartDrop);
    if (State.Beam) {
      MoveHeldBeam(State.Beam, BeamStart, End);
    } else {
      State.Beam = SpawnHeldBeam(Beam.BeamTemplate, Beam.BeamEndName, BeamStart, End, GetTeamColor(Pawn));
    }
  }
  OnRoundStart() {
    for (const Slot of this.PlayerStates.keys()) {
      this.ClearPlayer(Slot);
    }
  }
  ClearPlayer(Slot) {
    const State = this.PlayerStates.get(Slot);
    if (State) {
      this.StopBeam(State);
      this.PlayerStates.delete(Slot);
    }
  }
  GetPlayerState(Slot) {
    let State = this.PlayerStates.get(Slot);
    if (!State) {
      State = { Beam: void 0, LastBeamTime: 0 };
      this.PlayerStates.set(Slot, State);
    }
    return State;
  }
  IsBeamOn(Pawn, State, Now) {
    const FireInterval = this.Settings.PrimaryLauncher ? this.Settings.PrimaryLauncher.FireInterval : 0;
    const bStillFiring = Now - State.LastBeamTime <= FireInterval + TickInterval * 1.5;
    return bStillFiring && Pawn.IsInputPressed(CSInputs2.ATTACK) && IsWeapon(Pawn.GetActiveWeapon(), this.Settings.Primary);
  }
  StopBeam(State) {
    if (State.Beam) {
      RemoveHeldBeam(State.Beam);
      State.Beam = void 0;
    }
  }
};
var ClassDefinitions = {
  ["demo" /* Demoman */]: new DemomanClass(),
  ["soldier" /* Solider */]: new SoldierClass(),
  ["medic" /* Medic */]: new MedicClass(),
  ["railer" /* Railer */]: new RailerClass(),
  ["beamer" /* Beamer */]: new BeamerClass()
};
function GiveLoadout(Pawn, PlayerClass2) {
  ClassDefinitions[PlayerClass2].ApplyLoadout(Pawn);
}
function PickRandomClass() {
  const Index = Math.floor(Math.random() * PlayableClasses.length);
  return PlayableClasses[Index] ?? "soldier" /* Solider */;
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
function IsWeaponAllowed(PlayerClass2, Weapon) {
  const Data = Weapon.GetData();
  if (!Data || Data.GetGearSlot() === CSGearSlot.C4) {
    return true;
  }
  const bIsKnife = Data.GetType() === CSWeaponType2.KNIFE;
  if (PlayerClass2 === "none" /* None */) {
    return bIsKnife;
  }
  const Settings = ClassDefinitions[PlayerClass2].Settings;
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

// src/bm_ui.ts
import { Instance as Instance7, CSInputs as CSInputs3 } from "cs_script/point_script";
var ClassUiName = "class_hud";
var MenuPanelId = "ClassMenu";
var BottomBarId = "BottomBar";
var IndicatorPanelId = "ClassIndicator";
var ClassNameLabelId = "ClassName";
var PickButtonPrefix = "Pick_";
var CloseButtonId = "CloseMenu";
var MenuToggleKey = CSInputs3.USE;
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
var ReloadBarId = "ReloadBar";
var BarSteps = 24;
var BarCharacter = "0";
var HiddenBar = -1;
var PayloadBarId = "PayloadBar";
var PayloadSectionPrefix = "PayloadSection";
var PayloadTickPrefix = "PayloadTick";
var PayloadPushersLabelId = "PayloadPushers";
var PayloadBarSteps = 60;
var MaxPayloadTicks = 5;
var PayloadStateClasses = ["Pushing", "Blocked", "RollingBack", "Overtime", "Delivered"];
var HurtHealthFraction = 0.5;
var CriticalHealthFraction = 0.25;
var AllClasses = Object.values(EPlayerClass);
var GOpenMenus = /* @__PURE__ */ new Set();
var GOfferedMenus = /* @__PURE__ */ new Set();
var GShownAmmo = /* @__PURE__ */ new Map();
var GShownHealth = /* @__PURE__ */ new Map();
var GShownBars = /* @__PURE__ */ new Map();
var GShownCounter = /* @__PURE__ */ new Map();
var GSentPayload = /* @__PURE__ */ new Map();
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
function OfferClassMenu(Slot, PlayerClass2) {
  if (GOfferedMenus.has(Slot) || PlayerClass2 !== "none" /* None */) {
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
  for (const PlayerClass2 of AllClasses) {
    if (PlayerClass2 === ClassValue) {
      return PlayerClass2;
    }
  }
  return void 0;
}
function ShowClassIndicator(Slot, PlayerClass2, IsT) {
  const Ui = FindClassUi();
  if (!Ui) {
    return;
  }
  const DisplayName = PlayerClass2 === "none" /* None */ ? NoClassName : ClassDefinitions[PlayerClass2].Settings.DisplayName;
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
  ShowBar(Slot, ChargeBarId, Ammo && Ammo.ChargeFraction > 0 ? Ammo.ChargeFraction : void 0);
  ShowBar(Slot, ReloadBarId, Ammo && Ammo.bReloading ? Ammo.ReloadFraction : void 0);
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
function ShowBar(Slot, BarId, Fraction) {
  const Steps = Fraction === void 0 ? HiddenBar : Math.floor(Math.min(1, Math.max(0, Fraction)) * BarSteps);
  let ShownBars = GShownBars.get(Slot);
  if (!ShownBars) {
    ShownBars = /* @__PURE__ */ new Map();
    GShownBars.set(Slot, ShownBars);
  }
  const LastSteps = ShownBars.get(BarId) ?? HiddenBar;
  if (Steps === LastSteps) {
    return;
  }
  const Ui = FindClassUi();
  if (!Ui) {
    return;
  }
  ShownBars.set(BarId, Steps);
  if (Steps === HiddenBar) {
    Ui.SetHasClassForPlayer(Slot, BarId, "Shown", false);
    return;
  }
  Ui.SetDialogVariableStringForPlayer(Slot, `${BarId}Fill`, "fill", BarCharacter.repeat(Steps));
  Ui.SetDialogVariableStringForPlayer(Slot, `${BarId}Empty`, "empty", BarCharacter.repeat(BarSteps - Steps));
  if (LastSteps === HiddenBar) {
    Ui.SetHasClassForPlayer(Slot, BarId, "Shown", true);
  }
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
function ShowPayload(Slot, Status) {
  const Ui = FindClassUi();
  if (!Ui) {
    return;
  }
  let Sent = GSentPayload.get(Slot);
  if (!Sent) {
    Sent = /* @__PURE__ */ new Map();
    GSentPayload.set(Slot, Sent);
  }
  if (!Status) {
    SetPayloadClass(Ui, Slot, Sent, PayloadBarId, "Shown", false);
    return;
  }
  const Boundaries = [0, ...Status.CheckpointFractions.slice(0, MaxPayloadTicks), 1];
  const Filled = Math.floor(Math.min(1, Math.max(0, Status.Progress)) * PayloadBarSteps);
  for (let Section = 0; Section <= MaxPayloadTicks; Section++) {
    const bUsed = Section < Boundaries.length - 1;
    const Start = bUsed ? Math.round((Boundaries[Section] ?? 1) * PayloadBarSteps) : PayloadBarSteps;
    const End = bUsed ? Math.round((Boundaries[Section + 1] ?? 1) * PayloadBarSteps) : PayloadBarSteps;
    const Fill = Math.min(Math.max(Filled - Start, 0), End - Start);
    SendPayloadText(Ui, Slot, Sent, `${PayloadSectionPrefix}${Section}Fill`, "fill", BarCharacter.repeat(Fill));
    SendPayloadText(Ui, Slot, Sent, `${PayloadSectionPrefix}${Section}Empty`, "empty", BarCharacter.repeat(End - Start - Fill));
  }
  for (let Tick2 = 1; Tick2 <= MaxPayloadTicks; Tick2++) {
    SetPayloadClass(Ui, Slot, Sent, `${PayloadTickPrefix}${Tick2}`, "Shown", Tick2 < Boundaries.length - 1);
    SetPayloadClass(Ui, Slot, Sent, `${PayloadTickPrefix}${Tick2}`, "Reached", Tick2 <= Status.CheckpointsReached);
  }
  const State = GetPayloadState(Status);
  for (const StateClass of PayloadStateClasses) {
    SetPayloadClass(Ui, Slot, Sent, PayloadBarId, StateClass, StateClass === State);
  }
  SendPayloadText(Ui, Slot, Sent, PayloadPushersLabelId, "pushers", State === "Pushing" ? `x${Status.Pushers}` : "");
  SetPayloadClass(Ui, Slot, Sent, PayloadBarId, "Shown", true);
}
function GetPayloadState(Status) {
  if (Status.bDelivered) {
    return "Delivered";
  }
  if (Status.bOvertime) {
    return "Overtime";
  }
  if (Status.bBlocked) {
    return "Blocked";
  }
  if (Status.Pushers > 0) {
    return "Pushing";
  }
  return Status.bRollingBack ? "RollingBack" : "";
}
function SendPayloadText(Ui, Slot, Sent, LabelId, VariableName, Text) {
  const Key = `${LabelId}|${VariableName}`;
  if (Sent.get(Key) === Text) {
    return;
  }
  Sent.set(Key, Text);
  Ui.SetDialogVariableStringForPlayer(Slot, LabelId, VariableName, Text);
}
function SetPayloadClass(Ui, Slot, Sent, PanelId, ClassName, bHasClass) {
  const Key = `${PanelId}.${ClassName}`;
  const Value = bHasClass ? "1" : "0";
  if ((Sent.get(Key) ?? "0") === Value) {
    return;
  }
  Sent.set(Key, Value);
  Ui.SetHasClassForPlayer(Slot, PanelId, ClassName, bHasClass);
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
  GShownBars.delete(Slot);
  GShownCounter.delete(Slot);
  GSentPayload.delete(Slot);
  const Ui = FindClassUi();
  if (!Ui) {
    return;
  }
  Ui.SetInputCaptureEnabled(Slot, false);
  Ui.ResetForPlayer(Slot);
}
function FindClassUi() {
  const Ui = Instance7.FindEntityByName(ClassUiName);
  if (IsCustomHudLayout2(Ui)) {
    return Ui;
  }
  if (!GbWarnedNoClassUi) {
    GbWarnedNoClassUi = true;
    const Problem = Ui ? "exists but isn't a custom_hud_layout" : "wasn't found";
    Instance7.Msg(`${LogPrefix} class menu: an entity named "${ClassUiName}" ${Problem}. Check the custom_hud_layout in Hammer, then do a full map build.`);
  }
  return void 0;
}
function IsCustomHudLayout2(Ent) {
  return Ent !== void 0 && "SetInputCaptureEnabled" in Ent && typeof Ent.SetInputCaptureEnabled === "function";
}

// src/bm_pickups.ts
import { Instance as Instance8 } from "cs_script/point_script";
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
var PickupBelowTolerance = 64;
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
    } else if (bDebug) {
      Instance8.DebugSphere({ center: Kit.Entity.GetAbsOrigin(), radius: 12, duration: TickInterval * 2, color: DebugKitColor });
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
  const Found = new Set(Instance8.FindEntitiesByName(HealthKitSettings.Name));
  for (const ClassName of KitClassNames) {
    for (const Ent of Instance8.FindEntitiesByClass(ClassName)) {
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
    Instance8.Msg(`${LogPrefix} ${Name} took a health kit: ${OldHealth} -> ${NewHealth}`);
  }
}
function RespawnKit(Kit) {
  Kit.RespawnTime = void 0;
  SetKitVisible(Kit, true);
  SpawnKitFx(HealthKitSettings.RespawnFxTemplate, Kit);
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

// src/bm_gamemode.ts
var GameMode = class {
  // Server settings for this mode, applied at each round start after the shared ones
  GetMatchCommands() {
    return [];
  }
  // Called when this becomes the mode being played, and when another mode takes over
  OnActivated() {
  }
  OnDeactivated() {
  }
  OnRoundStart() {
  }
  OnRoundEnd() {
  }
  // Called whenever a player spawns or respawns
  OnPlayerSpawn(Pawn, Slot) {
  }
  // Called on every mode when a player leaves, so none of them keep stale state
  OnPlayerLeave(Slot) {
  }
  Tick(Now, DeltaTime) {
  }
  // Called every tick for each human player, for this mode's part of the HUD
  TickPlayerHud(Pawn, Slot) {
  }
};

// src/bm_bots.ts
import { Instance as Instance9 } from "cs_script/point_script";
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
  GBotReadyAt.set(Slot, Instance9.GetGameTime() + BotSpawnSettleTime);
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
    for (const Marker of Instance9.FindEntitiesByName(MarkerName)) {
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
  Pawn.SetHealth(Pawn.GetMaxHealth());
}
function DriveBot(Pawn, Assignment) {
  if (Assignment.Mode === 0 /* Still */ || !Pawn.GetGroundEntity()) {
    return;
  }
  if (Assignment.Mode === 2 /* Jump */) {
    Pawn.Teleport({ velocity: { x: 0, y: 0, z: BotJumpSpeed } });
    return;
  }
  const Forward = VectorMath.GetForwardVector({ pitch: 0, yaw: Assignment.Yaw, roll: 0 });
  Pawn.Teleport({ velocity: { x: Forward.x * BotRunSpeed, y: Forward.y * BotRunSpeed, z: Pawn.GetAbsVelocity().z } });
}

// src/bm_freeforall.ts
var FreeForAllSettings = {
  bFriendlyFire: true
};
var FreeForAllMode = class extends GameMode {
  DisplayName = "Free for all";
  IsMapSetUp() {
    return true;
  }
  IsFriendlyFire() {
    return FreeForAllSettings.bFriendlyFire;
  }
  GetMatchCommands() {
    if (!bDebug) {
      return [];
    }
    return [
      "mp_roundtime 60",
      "mp_roundtime_defuse 60",
      "mp_roundtime_hostage 60",
      "mp_ignore_round_win_conditions 1",
      "mp_respawn_on_death_t 1",
      "mp_respawn_on_death_ct 1",
      "bot_stop 1"
    ];
  }
  OnPlayerSpawn(Pawn, Slot) {
    ResetBotMode(Slot);
  }
  OnPlayerLeave(Slot) {
    ForgetBot(Slot);
  }
  Tick(Now, DeltaTime) {
    TickBots(Now);
  }
};

// src/bm_payload.ts
import { Instance as Instance10, CSDamageFlags as CSDamageFlags2 } from "cs_script/point_script";
var PayloadSettings = {
  CartName: "payload_cart",
  PathPrefix: "payload_path_",
  CheckpointTag: "checkpoint",
  PushRadius: 160,
  PushHeightBelow: 64,
  PushHeightAbove: 128,
  PushSpeed: 55,
  MaxPushers: 3,
  RollbackDelay: 30,
  RollbackSpeed: 25,
  RoundTime: 300,
  CheckpointBonusTime: 120,
  PusherHealPerSecond: 10,
  TurnBlendDistance: 48
};
var AttackingTeam = 2 /* Terrorist */;
var DefendingTeam = 3 /* CounterTerrorist */;
var PathPointClasses = ["info_target", "path_track"];
var CartClasses = ["prop_dynamic", "prop_dynamic_override"];
var RescanInterval2 = 1;
var WinEliminationDelay = 0.2;
var WinEliminationTimeout = 3;
var TrackDebugColor = { r: 240, g: 200, b: 60 };
var CheckpointDebugColor = { r: 120, g: 230, b: 120 };
var CartDebugColor = { r: 220, g: 60, b: 50 };
var GTrack = void 0;
var GCart = void 0;
var GDistance = 0;
var GSavedDistance = 0;
var GCheckpointsReached = 0;
var GLastAttendedTime = 0;
var GbRoundTimerSet = false;
var GbRoundOver = false;
var GbDelivered = false;
var GNextScanTime = 0;
var GStatus = void 0;
var GPendingWinner = void 0;
var GWinStartedAt = 0;
var GbWinFellBack = false;
var GLastScanReport = "";
var GHealAccumulators = /* @__PURE__ */ new Map();
var PayloadMode = class extends GameMode {
  DisplayName = "Payload";
  IsMapSetUp() {
    ScanPayload();
    return IsPayloadReady();
  }
  IsFriendlyFire() {
    return false;
  }
  GetMatchCommands() {
    const Minutes = PayloadSettings.RoundTime / 60;
    return [
      "mp_ignore_round_win_conditions 1",
      "mp_respawn_on_death_t 1",
      "mp_respawn_on_death_ct 1",
      `mp_roundtime ${Minutes}`,
      `mp_roundtime_defuse ${Minutes}`,
      `mp_roundtime_hostage ${Minutes}`,
      "bot_stop 0"
    ];
  }
  OnActivated() {
    PlaceCart(true);
  }
  OnDeactivated() {
    for (const Controller of Instance10.GetAllPlayerControllers()) {
      ShowPayload(Controller.GetPlayerSlot(), void 0);
    }
  }
  OnRoundStart() {
    ScanPayload();
    GDistance = 0;
    GSavedDistance = 0;
    GCheckpointsReached = 0;
    GbRoundTimerSet = false;
    GbRoundOver = false;
    GbDelivered = false;
    GPendingWinner = void 0;
    GHealAccumulators.clear();
    GStatus = void 0;
    PlaceCart(true);
  }
  OnRoundEnd() {
    GbRoundOver = true;
    GPendingWinner = void 0;
  }
  Tick(Now, DeltaTime) {
    TickPayload(Now, DeltaTime);
  }
  TickPlayerHud(Pawn, Slot) {
    ShowPayload(Slot, IsPayloadReady() ? GStatus : void 0);
  }
};
function IsPayloadReady() {
  return GTrack !== void 0 && GCart !== void 0 && GCart.Entity.IsValid();
}
function TickPayload(Now, DeltaTime) {
  if (!IsPayloadReady() && Now >= GNextScanTime) {
    GNextScanTime = Now + RescanInterval2;
    ScanPayload();
    PlaceCart(true);
  }
  const Track = GTrack;
  if (!Track || !IsPayloadReady()) {
    return;
  }
  if (bDebug) {
    DrawTrack(Track);
  }
  if (GPendingWinner !== void 0) {
    TickPendingWin(GPendingWinner, Now);
  }
  if (GbRoundOver || Instance10.IsWarmupPeriod() || Instance10.IsFreezePeriod()) {
    GStatus = MakeStatus(Track, 0, false, false, false, Now);
    return;
  }
  if (!GbRoundTimerSet) {
    GbRoundTimerSet = true;
    GLastAttendedTime = Now;
    Instance10.SetRoundRemainingTime(PayloadSettings.RoundTime);
  }
  const Crowd = FindCartCrowd(GetTrackPosition(Track, GDistance));
  const Pushers = Math.min(Crowd.Attackers.length, PayloadSettings.MaxPushers);
  const bBlocked = Crowd.Attackers.length > 0 && Crowd.Defenders > 0;
  if (Crowd.Attackers.length > 0) {
    GLastAttendedTime = Now;
  }
  HealPushers(Crowd.Attackers, DeltaTime);
  let bRollingBack = false;
  if (Pushers > 0 && !bBlocked) {
    GDistance = Math.min(Track.Length, GDistance + PayloadSettings.PushSpeed * GetPushMultiplier(Pushers) * DeltaTime);
  } else if (Crowd.Attackers.length === 0 && PayloadSettings.RollbackDelay > 0 && Now - GLastAttendedTime >= PayloadSettings.RollbackDelay && GDistance > GSavedDistance) {
    GDistance = Math.max(GSavedDistance, GDistance - PayloadSettings.RollbackSpeed * DeltaTime);
    bRollingBack = true;
  }
  ReachCheckpoints(Track, Now);
  PlaceCart(false);
  const bTimeUp = Instance10.GetRoundRemainingTime() <= 0;
  if (GDistance >= Track.Length) {
    GbDelivered = true;
    EndRound(AttackingTeam, Now);
  } else if (bTimeUp && Crowd.Attackers.length === 0) {
    EndRound(DefendingTeam, Now);
  }
  GStatus = MakeStatus(Track, Pushers, bBlocked && !GbRoundOver, bRollingBack, bTimeUp && !GbRoundOver, Now);
}
function GetPushMultiplier(Pushers) {
  let Multiplier = 0;
  for (let Pusher = 1; Pusher <= Pushers; Pusher++) {
    Multiplier += 1 / Pusher;
  }
  return Multiplier;
}
function FindCartCrowd(CartPosition) {
  const Attackers = [];
  let Defenders = 0;
  ForEachLivePawn((Pawn) => {
    const Feet = Pawn.GetAbsOrigin();
    const FlatDistance = Math.hypot(Feet.x - CartPosition.x, Feet.y - CartPosition.y);
    const Height = Feet.z - CartPosition.z;
    if (FlatDistance > PayloadSettings.PushRadius || Height < -PayloadSettings.PushHeightBelow || Height > PayloadSettings.PushHeightAbove) {
      return;
    }
    const Team = Pawn.GetTeamNumber();
    if (Team === AttackingTeam) {
      Attackers.push(Pawn);
    } else if (Team === DefendingTeam) {
      Defenders++;
    }
  });
  return { Attackers, Defenders };
}
function HealPushers(Attackers, DeltaTime) {
  if (PayloadSettings.PusherHealPerSecond <= 0) {
    return;
  }
  for (const Pawn of Attackers) {
    const Slot = GetPlayerSlot(Pawn);
    const MaxHealth = Pawn.GetMaxHealth();
    const Health = Pawn.GetHealth();
    if (Health >= MaxHealth) {
      GHealAccumulators.delete(Slot);
      continue;
    }
    const Accumulated = (GHealAccumulators.get(Slot) ?? 0) + PayloadSettings.PusherHealPerSecond * DeltaTime;
    const WholeHealth = Math.floor(Accumulated);
    GHealAccumulators.set(Slot, Accumulated - WholeHealth);
    if (WholeHealth > 0) {
      Pawn.SetHealth(Math.min(MaxHealth, Health + WholeHealth));
    }
  }
}
function ReachCheckpoints(Track, Now) {
  while (GCheckpointsReached < Track.Checkpoints.length) {
    const CheckpointDistance = Track.Checkpoints[GCheckpointsReached];
    if (CheckpointDistance === void 0 || GDistance < CheckpointDistance) {
      return;
    }
    GCheckpointsReached++;
    GSavedDistance = CheckpointDistance;
    Instance10.SetRoundRemainingTime(Math.max(0, Instance10.GetRoundRemainingTime()) + PayloadSettings.CheckpointBonusTime);
    Instance10.Msg(`${LogPrefix} payload: checkpoint ${GCheckpointsReached} / ${Track.Checkpoints.length} reached, +${PayloadSettings.CheckpointBonusTime}s`);
  }
}
function EndRound(Winner, Now) {
  if (GbRoundOver) {
    return;
  }
  GbRoundOver = true;
  GPendingWinner = Winner;
  GWinStartedAt = Now;
  GbWinFellBack = false;
  const Loser = GetOtherTeam(Winner);
  Instance10.ServerCommand("mp_ignore_round_win_conditions 0");
  Instance10.ServerCommand(`mp_respawn_on_death_${Loser === 2 /* Terrorist */ ? "t" : "ct"} 0`);
  Instance10.Msg(`${LogPrefix} payload: ${Winner === AttackingTeam ? "Ts delivered the cart" : "time's up, CTs held"}`);
}
function TickPendingWin(Winner, Now) {
  const Elapsed = Now - GWinStartedAt;
  if (Elapsed < WinEliminationDelay) {
    return;
  }
  const Loser = GetOtherTeam(Winner);
  ForEachLivePawn((Pawn) => {
    if (Pawn.GetTeamNumber() === Loser) {
      Pawn.TakeDamage({ damage: Pawn.GetHealth() + 1e3, damageFlags: CSDamageFlags2.FORCE_DEATH | CSDamageFlags2.IGNORE_ARMOR });
    }
  });
  if (Elapsed > WinEliminationTimeout && !GbWinFellBack) {
    GbWinFellBack = true;
    Instance10.SetRoundRemainingTime(0);
    Instance10.Msg(`${LogPrefix} payload: the round didn't end on its own (is the losing side empty?), so the clock was run out`);
  }
}
function GetOtherTeam(Team) {
  return Team === 2 /* Terrorist */ ? 3 /* CounterTerrorist */ : 2 /* Terrorist */;
}
function MakeStatus(Track, Pushers, bBlocked, bRollingBack, bOvertime, Now) {
  const Status = {
    Progress: Track.Length > 0 ? GDistance / Track.Length : 0,
    Pushers,
    bBlocked,
    bRollingBack,
    bOvertime,
    bDelivered: GbDelivered,
    CheckpointsReached: GCheckpointsReached,
    CheckpointFractions: Track.Checkpoints.map((CheckpointDistance) => {
      return Track.Length > 0 ? CheckpointDistance / Track.Length : 0;
    })
  };
  return Status;
}
function ScanPayload() {
  const CartEntity = FindCartEntity();
  const Points = FindPathPoints();
  if (CartEntity && Points.length >= 2) {
    GTrack = BuildTrack(Points);
    if (!GCart || GCart.Entity !== CartEntity) {
      GCart = MakeCart(CartEntity, GTrack);
    }
  } else {
    GTrack = void 0;
    GCart = void 0;
  }
  const Report = IsPayloadReady() && GTrack ? `payload on: ${GTrack.Points.length} track points, ${Math.round(GTrack.Length)}u long, ${GTrack.Checkpoints.length} checkpoints. Ts push, CTs defend, no friendly fire.` : CartEntity || Points.length > 0 ? `payload off: found ${CartEntity ? "a cart" : "no cart"} ("${PayloadSettings.CartName}") and ${Points.length} track points ("${PayloadSettings.PathPrefix}1" ...). It needs a cart and at least 2 points.` : "";
  if (Report !== "" && Report !== GLastScanReport) {
    Instance10.Msg(`${LogPrefix} ${Report}`);
  }
  GLastScanReport = Report;
}
function FindCartEntity() {
  const Named = Instance10.FindEntitiesByName(PayloadSettings.CartName).find((Ent) => {
    return Ent.IsValid();
  });
  if (Named) {
    return Named;
  }
  for (const ClassName of CartClasses) {
    for (const Ent of Instance10.FindEntitiesByClass(ClassName)) {
      if (Ent.IsValid() && Ent.GetEntityName().includes(PayloadSettings.CartName)) {
        return Ent;
      }
    }
  }
  return void 0;
}
function FindPathPoints() {
  const Candidates = new Set(Instance10.FindEntitiesByName(`${PayloadSettings.PathPrefix}*`));
  for (const ClassName of PathPointClasses) {
    for (const Ent of Instance10.FindEntitiesByClass(ClassName)) {
      Candidates.add(Ent);
    }
  }
  const Numbered = /* @__PURE__ */ new Map();
  for (const Ent of Candidates) {
    const PathNumber = Ent.IsValid() ? GetPathNumber(Ent.GetEntityName()) : void 0;
    if (PathNumber !== void 0 && !Numbered.has(PathNumber)) {
      Numbered.set(PathNumber, Ent);
    }
  }
  return [...Numbered.entries()].sort((A, B) => {
    return A[0] - B[0];
  }).map((Entry) => {
    return Entry[1];
  });
}
function GetPathNumber(Name) {
  const Lower = Name.toLowerCase();
  const Start = Lower.indexOf(PayloadSettings.PathPrefix);
  if (Start < 0) {
    return void 0;
  }
  const Digits = Lower.substring(Start + PayloadSettings.PathPrefix.length).match(/^\d+/);
  return Digits ? Number(Digits[0]) : void 0;
}
function BuildTrack(PointEntities) {
  const Points = [];
  const Distances = [];
  const Directions = [];
  const Checkpoints = [];
  let Length = 0;
  for (let Index = 0; Index < PointEntities.length; Index++) {
    const Ent = PointEntities[Index];
    if (!Ent) {
      continue;
    }
    const Point = Ent.GetAbsOrigin();
    const Previous = Points[Points.length - 1];
    if (Previous) {
      const Segment = VectorMath.Subtract(Point, Previous);
      Length += VectorMath.Size(Segment);
      Directions.push(VectorMath.GetSafeNormal(Segment));
    }
    Points.push(Point);
    Distances.push(Length);
    const bInterior = Index > 0 && Index < PointEntities.length - 1;
    if (bInterior && Ent.GetEntityName().toLowerCase().includes(PayloadSettings.CheckpointTag)) {
      Checkpoints.push(Length);
    }
  }
  return { Points, Distances, Directions, Length, Checkpoints };
}
function MakeCart(CartEntity, Track) {
  const FirstDirection = Track.Directions[0] ?? { x: 1, y: 0, z: 0 };
  const TrackRotation = RotationMath.FromRotator(VectorMath.GetRotation(FirstDirection));
  const PlacedRotation = RotationMath.FromRotator(CartEntity.GetAbsAngles());
  return { Entity: CartEntity, LocalRotation: RotationMath.Multiply(RotationMath.Inverse(TrackRotation), PlacedRotation) };
}
function GetSegmentIndex(Track, Distance) {
  for (let Index = 0; Index < Track.Directions.length; Index++) {
    const End = Track.Distances[Index + 1] ?? Track.Length;
    if (Distance <= End) {
      return Index;
    }
  }
  return Math.max(0, Track.Directions.length - 1);
}
function GetTrackPosition(Track, Distance) {
  const Index = GetSegmentIndex(Track, Distance);
  const Start = Track.Points[Index] ?? { x: 0, y: 0, z: 0 };
  const Direction = Track.Directions[Index] ?? { x: 1, y: 0, z: 0 };
  const Along = Distance - (Track.Distances[Index] ?? 0);
  return VectorMath.Add(Start, VectorMath.Scale(Direction, Along));
}
function GetTrackDirection(Track, Distance) {
  const Index = GetSegmentIndex(Track, Distance);
  const Direction = Track.Directions[Index] ?? { x: 1, y: 0, z: 0 };
  const SegmentStart = Track.Distances[Index] ?? 0;
  const SegmentEnd = Track.Distances[Index + 1] ?? Track.Length;
  const Blend = Math.min(PayloadSettings.TurnBlendDistance, (SegmentEnd - SegmentStart) / 2);
  if (Blend <= 0) {
    return Direction;
  }
  const Previous = Track.Directions[Index - 1];
  const Next = Track.Directions[Index + 1];
  const IntoSegment = Distance - SegmentStart;
  const LeftInSegment = SegmentEnd - Distance;
  if (Previous && IntoSegment < Blend) {
    return BlendDirections(Previous, Direction, (IntoSegment + Blend) / (2 * Blend));
  }
  if (Next && LeftInSegment < Blend) {
    return BlendDirections(Direction, Next, (Blend - LeftInSegment) / (2 * Blend));
  }
  return Direction;
}
function BlendDirections(From, To, Alpha) {
  return VectorMath.GetSafeNormal(VectorMath.Add(VectorMath.Scale(From, 1 - Alpha), VectorMath.Scale(To, Alpha)));
}
function PlaceCart(bTeleport) {
  const Track = GTrack;
  const Cart = GCart;
  if (!Track || !Cart || !Cart.Entity.IsValid()) {
    return;
  }
  const Position = GetTrackPosition(Track, GDistance);
  const TrackRotation = RotationMath.FromRotator(VectorMath.GetRotation(GetTrackDirection(Track, GDistance)));
  const Angles = RotationMath.ToRotator(RotationMath.Multiply(TrackRotation, Cart.LocalRotation));
  if (bTeleport) {
    Cart.Entity.Teleport({ position: Position, angles: Angles });
  } else {
    Cart.Entity.Move({ position: Position, angles: Angles });
  }
}
function DrawTrack(Track) {
  for (let Index = 1; Index < Track.Points.length; Index++) {
    const From = Track.Points[Index - 1];
    const To = Track.Points[Index];
    if (From && To) {
      Instance10.DebugLine({ start: From, end: To, duration: TickInterval * 2, color: TrackDebugColor });
    }
  }
  for (const CheckpointDistance of Track.Checkpoints) {
    Instance10.DebugSphere({ center: GetTrackPosition(Track, CheckpointDistance), radius: 16, duration: TickInterval * 2, color: CheckpointDebugColor });
  }
  Instance10.DebugSphere({ center: GetTrackPosition(Track, GDistance), radius: PayloadSettings.PushRadius, duration: TickInterval * 2, color: CartDebugColor });
}

// src/bm_main.ts
var AirshotMinHeight = 64;
var ClassChatCommands = /* @__PURE__ */ new Map(
  [
    ["!demo", "demo" /* Demoman */],
    ["!medic", "medic" /* Medic */],
    ["!solider", "soldier" /* Solider */],
    ["!railer", "railer" /* Railer */],
    ["!beamer", "beamer" /* Beamer */],
    ["!none", "none" /* None */]
  ]
);
var FreeForAll = new FreeForAllMode();
var GameModes = [new PayloadMode(), FreeForAll];
var GActiveMode = FreeForAll;
function Tick() {
  const Now = Instance11.GetGameTime();
  Instance11.SetNextThink(Now + TickInterval);
  const DeltaTime = Math.min(0.1, Math.max(0, Now - GLastThinkTime)) || TickInterval;
  GLastThinkTime = Now;
  try {
    TickMatch(Now);
    TickTimers(Now);
    for (const Definition of Object.values(ClassDefinitions)) {
      Definition.TickWorld(Now, DeltaTime);
    }
    ForEachLivePawn((Pawn, Slot) => {
      const PlayerClass2 = GClassBySlot.get(Slot);
      if (PlayerClass2 !== void 0) {
        const Definition = ClassDefinitions[PlayerClass2];
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
    GActiveMode.Tick(Now, DeltaTime);
    TickHealthKits(Now);
    TickClassMenuKey();
    TickPlayerHud();
    TickNoBuying();
    TickBotClasses();
  } catch (Exception) {
    Instance11.Msg(`${LogPrefix} error: ${String(Exception)}`);
  }
}
function BeginPlay() {
  SelectGameMode();
  Instance11.OnPlayerChat(HandlePlayerChat);
  Instance11.OnPlayerReset(HandlePlayerReset);
  Instance11.OnPlayerKill(HandlePlayerKill);
  Instance11.OnPlayerDisconnect(HandlePlayerDisconnect);
  Instance11.OnRoundStart(HandleRoundStart);
  Instance11.OnRoundEnd(HandleRoundEnd);
  Instance11.OnGunFire(HandleGunFire);
  Instance11.OnWeaponPickup(HandleWeaponPickup);
  Instance11.OnWeaponDrop(HandleWeaponDrop);
  Instance11.OnPlayerDamage(HandlePlayerDamage);
  Instance11.OnModifyPlayerDamage(HandleModifyPlayerDamage);
  Instance11.OnCustomHudClicked(HandleCustomHudClicked);
  Instance11.SetThink(Tick);
  Instance11.SetNextThink(Instance11.GetGameTime());
  Instance11.Msg(`${LogPrefix} loaded${bDebug ? " (DEBUG on)" : ""}`);
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
  const PlayerClass2 = ClassChatCommands.get(Command);
  if (PlayerClass2 !== void 0) {
    RequestPlayerClass(Player, PlayerClass2);
  }
}
function HandlePlayerReset(Event) {
  const Pawn = Event.player;
  const Slot = GetPlayerSlot(Pawn);
  if (Slot === INDEX_NONE) {
    return;
  }
  ClearPlayer(Slot);
  GActiveMode.OnPlayerSpawn(Pawn, Slot);
  AssignRandomBotClass(Pawn, Slot);
  const bHadClass = GClassBySlot.has(Slot);
  ApplyPendingClass(Slot);
  RefreshClassUi(Pawn, Slot);
  const PlayerClass2 = GClassBySlot.get(Slot);
  SetTimer(0.1, () => {
    if (!Pawn.IsValid() || !Pawn.IsAlive()) {
      return;
    }
    if (PlayerClass2 === void 0) {
      if (bHadClass) {
        RestoreDefaultBody(Pawn);
      }
      GiveNoClassLoadout(Pawn);
    } else {
      GiveLoadout(Pawn, PlayerClass2);
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
  for (const Mode of GameModes) {
    Mode.OnPlayerLeave(Event.playerSlot);
  }
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
  SelectGameMode();
  GActiveMode.OnRoundStart();
  ApplyMatchSettings();
  Instance11.Msg(`${LogPrefix} match settings applied (${GActiveMode.DisplayName})`);
}
function HandleRoundEnd() {
  GActiveMode.OnRoundEnd();
}
function HandleGunFire(Event) {
  const Weapon = Event.weapon;
  const Pawn = Weapon.GetOwner();
  const Slot = GetPlayerSlot(Pawn);
  const PlayerClass2 = GClassBySlot.get(Slot);
  if (!Pawn || PlayerClass2 === void 0) {
    return;
  }
  const Definition = ClassDefinitions[PlayerClass2];
  if (IsWeapon(Weapon, Definition.Settings.Primary) && !Definition.Settings.PrimaryLauncher) {
    Definition.OnPrimaryFire(Pawn, Slot, Instance11.GetGameTime());
  } else if (IsWeapon(Weapon, Definition.Settings.Secondary) && !Definition.Settings.SecondaryLauncher) {
    Definition.OnSecondaryFire(Pawn, Slot, Instance11.GetGameTime());
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
  if ((Event.damageFlags & CSDamageFlags3.FORCE_DEATH) !== 0) {
    return;
  }
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
function SelectGameMode() {
  const Mode = GameModes.find((Candidate) => {
    return Candidate.IsMapSetUp();
  }) ?? FreeForAll;
  if (Mode !== GActiveMode) {
    GActiveMode.OnDeactivated();
    GActiveMode = Mode;
    Mode.OnActivated();
    Instance11.Msg(`${LogPrefix} game mode: ${Mode.DisplayName}`);
  }
  SetFriendlyFire(Mode.IsFriendlyFire());
}
function ApplyMatchSettings() {
  const Commands = [];
  Commands.push(`mp_teammates_are_enemies ${IsFriendlyFire() ? 1 : 0}`, `mp_friendlyfire ${IsFriendlyFire() ? 1 : 0}`);
  if (bDebug) {
    Commands.push("mp_do_warmup_period 0", "mp_warmuptime 0", "mp_freezetime 0");
    Commands.push("sv_infinite_ammo 1");
    Commands.push("bot_quota_mode fill", "bot_quota 8", "bot_join_team any");
  }
  Commands.push(...GActiveMode.GetMatchCommands());
  for (const Command of Commands) {
    Instance11.ServerCommand(Command);
  }
}
function TickMatch(Now) {
  if (bDebug && Instance11.IsWarmupPeriod()) {
    Instance11.ServerCommand("mp_warmup_end");
  }
}
function RequestPlayerClass(Player, PlayerClass2) {
  const Slot = Player.GetPlayerSlot();
  const CurrentClass = GClassBySlot.get(Slot) ?? "none" /* None */;
  const Pawn = Player.GetPlayerPawn();
  const bAlive = Pawn !== void 0 && Pawn.IsValid() && Pawn.IsAlive();
  if (!bAlive || CurrentClass === "none" /* None */) {
    GPendingClassBySlot.delete(Slot);
    SetPlayerClass(Player, PlayerClass2);
    return;
  }
  if (PlayerClass2 === CurrentClass) {
    GPendingClassBySlot.delete(Slot);
  } else {
    GPendingClassBySlot.set(Slot, PlayerClass2);
  }
  ShowClassIndicator(Slot, CurrentClass, Pawn?.GetTeamNumber() === 2);
  Instance11.Msg(`${LogPrefix} ${Player.GetPlayerName()} -> ${PlayerClass2} on respawn`);
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
function SetPlayerClass(Player, PlayerClass2) {
  const Slot = Player.GetPlayerSlot();
  ClearPlayer(Slot);
  const Pawn = Player.GetPlayerPawn();
  if (PlayerClass2 === "none" /* None */) {
    GClassBySlot.delete(Slot);
    if (Pawn && Pawn.IsAlive()) {
      RestoreDefaultBody(Pawn);
      GiveNoClassLoadout(Pawn);
    }
  } else {
    GClassBySlot.set(Slot, PlayerClass2);
    if (Pawn && Pawn.IsAlive()) {
      GiveLoadout(Pawn, PlayerClass2);
    }
  }
  ShowClassIndicator(Slot, PlayerClass2, Pawn?.GetTeamNumber() === 2);
  const ClassLabel = PlayerClass2 === "none" /* None */ ? "normal" : PlayerClass2;
  Instance11.Msg(`${LogPrefix} ${Player.GetPlayerName()} -> ${ClassLabel}`);
}
function AssignRandomBotClass(Pawn, Slot) {
  const Controller = Pawn.GetPlayerController();
  if (!Controller || !Controller.IsBot() || GClassBySlot.has(Slot) || GPendingClassBySlot.has(Slot)) {
    return false;
  }
  const PlayerClass2 = PickRandomClass();
  GClassBySlot.set(Slot, PlayerClass2);
  Instance11.Msg(`${LogPrefix} ${Controller.GetPlayerName()} (bot) -> ${PlayerClass2}`);
  return true;
}
function TickBotClasses() {
  ForEachLivePawn((Pawn, Slot) => {
    const PlayerClass2 = AssignRandomBotClass(Pawn, Slot) ? GClassBySlot.get(Slot) : void 0;
    if (PlayerClass2 !== void 0) {
      GiveLoadout(Pawn, PlayerClass2);
    }
  });
}
function RefreshClassUi(Pawn, Slot) {
  const Controller = Pawn.GetPlayerController();
  if (!Controller || Controller.IsBot()) {
    return;
  }
  const PlayerClass2 = GClassBySlot.get(Slot) ?? "none" /* None */;
  ShowClassIndicator(Slot, PlayerClass2, Pawn?.GetTeamNumber() === 2);
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
      const PlayerClass2 = GClassBySlot.get(Slot);
      ShowHealth(Slot, Pawn);
      ShowAmmo(Slot, GetLauncherAmmo(Pawn, Slot));
      ShowCounter(Slot, PlayerClass2 !== void 0 ? ClassDefinitions[PlayerClass2].GetHudCounter(Slot) : void 0);
      GActiveMode.TickPlayerHud(Pawn, Slot);
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
  const PlayerClass2 = GClassBySlot.get(Slot) ?? "none" /* None */;
  if (IsWeaponAllowed(PlayerClass2, Weapon)) {
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
