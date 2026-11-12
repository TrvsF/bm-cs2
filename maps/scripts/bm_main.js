// src/bm_main.ts
import { Instance as Instance16, Console as Console17, GameRules as GameRules4, Entities as Entities7, CSDamageTypes as CSDamageTypes4, CSDamageFlags as CSDamageFlags4, CSGearSlot as CSGearSlot5 } from "cs_script/point_script";

// src/bm_core.ts
import { Instance, Console, Entities, CSWeaponType } from "cs_script/point_script";
var bDebug = false;
var TickInterval = 1 / 64;
var INDEX_NONE = -1;
var LogPrefix = "[BM]";
var ChatCommandPrefix = "-";
var MaxPlayerSlots = 64;
var UpVector = { x: 0, y: 0, z: 1 };
var ZeroVector = { x: 0, y: 0, z: 0 };
var ChestOffset = { x: 0, y: 0, z: 40 };
var TerroristColor = { r: 238, g: 158, b: 153 };
var CounterTerroristColor = { r: 163, g: 193, b: 243 };
var GPendingTimers = [];
var GBotControls = /* @__PURE__ */ new Map();
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
function IsFreeForAll() {
  const Value = Console.GetConvarString("mp_teammates_are_enemies");
  return Value === "1" || Value === "true";
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
  static ClosestPointOnSegment(Point, Start, End) {
    const Segment = _VectorMath.Subtract(End, Start);
    const LengthSquared = _VectorMath.Dot(Segment, Segment);
    if (LengthSquared <= 0) {
      return Start;
    }
    const Alpha = Math.min(1, Math.max(0, _VectorMath.Dot(_VectorMath.Subtract(Point, Start), Segment) / LengthSquared));
    return _VectorMath.Add(Start, _VectorMath.Scale(Segment, Alpha));
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
function ConsumePress(Pawn, Held, Input) {
  const bDown = IsInputDown(Pawn, Input);
  const bWasDown = (Held.Mask & Input) !== 0;
  Held.Mask = bDown ? Held.Mask | Input : Held.Mask & ~Input;
  return bDown && !bWasDown;
}
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
function FindEntityByName(Name) {
  return Entities.FindByName(Name)[0];
}
function FindPointTemplate(Name) {
  const Template = FindEntityByName(Name);
  return IsPointTemplate(Template) ? Template : void 0;
}
function GetChestPosition(Pawn) {
  return VectorMath.Add(Pawn.GetAbsOrigin(), ChestOffset);
}
function IsTeammate(A, B) {
  return !IsFreeForAll() && A.GetTeamNumber() === B.GetTeamNumber();
}
function GetPawnName(Pawn) {
  return Pawn.GetPlayerController()?.GetPlayerName() ?? "someone";
}
function GetOrCreate(Values, Key, Create) {
  let Value = Values.get(Key);
  if (Value === void 0) {
    Value = Create();
    Values.set(Key, Value);
  }
  return Value;
}
function GetTeamColor(Ent) {
  return GetColorForTeam(Ent.GetTeamNumber());
}
function GetColorForTeam(Team) {
  return Team === 2 /* Terrorist */ ? TerroristColor : CounterTerroristColor;
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
function IsKnife(Weapon) {
  const Data = Weapon?.GetData();
  return Data !== void 0 && Data.GetType() === CSWeaponType.KNIFE;
}
function SpawnTemplateEntities(TemplateName, Position, Rotation) {
  const Template = FindPointTemplate(TemplateName);
  if (!Template) {
    return [];
  }
  const Spawned = Rotation ? Template.ForceSpawn(Position, Rotation) : Template.ForceSpawn(Position);
  return Spawned ?? [];
}
function IsModelEntity(Ent) {
  return "SetModelScale" in Ent && typeof Ent.SetModelScale === "function";
}
function ForEachPlayer(Visitor) {
  for (let Slot = 0; Slot < MaxPlayerSlots; Slot++) {
    const Controller = Instance.GetPlayerController(Slot);
    if (Controller && Controller.IsConnected()) {
      Visitor(Controller, Slot);
    }
  }
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
function SetBotControl(Slot, Control) {
  if (Control) {
    GBotControls.set(Slot, Control);
  } else {
    GBotControls.delete(Slot);
  }
}
function IsBotControlled(Pawn) {
  return GBotControls.has(GetPlayerSlot(Pawn));
}
function IsInputDown(Pawn, Input) {
  const Control = GBotControls.get(GetPlayerSlot(Pawn));
  return Control ? (Control.Inputs & Input) !== 0 : Pawn.IsInputPressed(Input);
}
function GetHeldWeapon(Pawn) {
  const Control = GBotControls.get(GetPlayerSlot(Pawn));
  return (Control ? Control.Weapon : void 0) ?? Pawn.GetActiveWeapon();
}
function GetAimAngles(Pawn) {
  const Control = GBotControls.get(GetPlayerSlot(Pawn));
  return Control ? Control.Aim : Pawn.GetEyeAngles();
}

// src/bm_classes.ts
import { Console as Console6, CSGearSlot as CSGearSlot2, CSDamageTypes as CSDamageTypes2, CSDamageFlags, CSHitGroup } from "cs_script/point_script";

// src/bm_combat.ts
import { Instance as Instance5, Console as Console5, CSDamageTypes, CSWeaponType as CSWeaponType2 } from "cs_script/point_script";

// src/bm_effects.ts
import { Instance as Instance2, Console as Console2, Entities as Entities2 } from "cs_script/point_script";
var ScorchTemplateName = "scorch_template";
var BloodTemplateName = "blood_template";
var MaxDecals = 48;
var ScorchSearchDistance = 16;
var BloodSplatterDistance = 128;
var GibTemplateName = "gib_template";
var GibFallbackTemplateName = "boom_template";
var GibLifetime = 5;
var GibFlingSpeed = 450;
var RefiredBeamLifetime = 0.15;
var BeamParticleSuffix = "_fx";
var BeamFxLingerTime = 1;
var SoundFiles = [
  "sounds/bm/shrinker_shrink.vsnd",
  "sounds/bm/shrinker_grow.vsnd",
  "sounds/bm/medic_heal_loop.vsnd"
];
var SoundEntityClass = "point_soundevent";
var SoundTemplateName = "bm_sound_template";
var SpawnTestClasses = ["point_soundevent", "info_target", "logic_relay", "info_particle_system", "prop_dynamic", "point_template"];
var OneShotSoundLifetime = 30;
var StoppedSoundLifetime = 0.5;
var SoundSourcePrefix = "bm_player_";
var GSoundPrecache = void 0;
var GbSoundSpawnFailed = false;
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
function SpawnGibs(Victim) {
  const Chest = GetChestPosition(Victim);
  SpawnBloodSplatter(VectorMath.Add(Chest, UpVector), Victim);
  const Spawned = SpawnTemporaryTemplate(GibTemplateName, Chest, GibLifetime) ?? SpawnTemporaryTemplate(GibFallbackTemplateName, Chest, GibLifetime) ?? [];
  const Momentum = Victim.GetAbsVelocity();
  for (const Ent of Spawned) {
    if (Ent.IsValid() && Ent.GetClassName().startsWith("prop_physics")) {
      const Direction = VectorMath.GetSafeNormal({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: 0.5 + Math.random() });
      Ent.Teleport({ velocity: VectorMath.Add(Momentum, VectorMath.Scale(Direction, GibFlingSpeed)) });
    }
  }
}
function SpawnTemporaryTemplate(TemplateName, Position, Lifetime) {
  const Template = FindPointTemplate(TemplateName);
  if (!Template) {
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
function PlaySoundOn(SoundEvent, Pawn) {
  const Spawned = SpawnSoundOn(SoundEvent, Pawn);
  if (Spawned.length === 0) {
    return;
  }
  const Remove = () => {
    RemoveEntities(Spawned);
  };
  for (const Ent of Spawned) {
    Entities2.ConnectOutput({ target: Ent, output: "OnSoundFinished", callback: Remove });
  }
  SetTimer(OneShotSoundLifetime, Remove);
}
function StartSoundOn(SoundEvent, Pawn) {
  return SpawnSoundOn(SoundEvent, Pawn);
}
function StopSound(Entities8) {
  for (const Ent of Entities8) {
    if (Ent.IsValid()) {
      Ent.FireInput({ input: "StopSound" });
    }
  }
  SetTimer(StoppedSoundLifetime, () => {
    RemoveEntities(Entities8);
  });
}
function PrecacheSounds() {
  GSoundPrecache ??= Instance2.Precache({ resources: [...SoundFiles], entities: [SoundEntityClass] });
}
function RunSpawnTest(Pawn) {
  const Precache = GSoundPrecache ? `server ${GSoundPrecache.IsServerLoaded()}, everyone ${GSoundPrecache.IsLoadedForAll()}` : "never made";
  Console2.Log(`${LogPrefix} spawn test: sound precache loaded: ${Precache}`);
  for (const ClassName of SpawnTestClasses) {
    let Result;
    try {
      const Spawned = Entities2.Spawn([{ classname: ClassName, origin: Pawn.GetAbsOrigin() }]);
      Result = `${Spawned.filter(IsValidEntity).length} of ${Spawned.length} valid`;
      RemoveEntities(Spawned);
    } catch (Exception) {
      Result = `threw ${String(Exception)}`;
    }
    Console2.Log(`${LogPrefix} spawn test: ${ClassName}: ${Result}`);
  }
}
function SpawnSoundOn(SoundEvent, Pawn) {
  if (!SoundEvent || !Pawn.IsValid()) {
    return [];
  }
  const SourceName = GetSoundSourceName(Pawn);
  const Spawned = SpawnSoundFromTemplate(SoundEvent, Pawn, SourceName) ?? SpawnSoundFromCode(SoundEvent, Pawn, SourceName);
  for (const Ent of Spawned) {
    Ent.SetParent(Pawn);
  }
  return Spawned;
}
function SpawnSoundFromTemplate(SoundEvent, Pawn, SourceName) {
  const Template = FindPointTemplate(SoundTemplateName);
  if (!Template) {
    return void 0;
  }
  const Spawned = (Template.ForceSpawn(Pawn.GetAbsOrigin()) ?? []).filter(IsValidEntity);
  for (const Ent of Spawned) {
    Ent.FireInput({ input: "SetSoundEventName", value: SoundEvent });
    Ent.FireInput({ input: "SetSourceEntity", value: SourceName });
    Ent.FireInput({ input: "StartSound" });
  }
  return Spawned;
}
function SpawnSoundFromCode(SoundEvent, Pawn, SourceName) {
  if (GbSoundSpawnFailed) {
    return [];
  }
  let Spawned = [];
  try {
    Spawned = Entities2.Spawn([
      {
        classname: SoundEntityClass,
        origin: Pawn.GetAbsOrigin(),
        soundName: SoundEvent,
        sourceEntityName: SourceName,
        entityIndexSelection: 1,
        startOnSpawn: true
      }
    ]).filter(IsValidEntity);
  } catch (Exception) {
    Console2.Log(`${LogPrefix} Entities.Spawn failed: ${String(Exception)}`);
  }
  if (Spawned.length === 0) {
    GbSoundSpawnFailed = true;
    Console2.Log(`${LogPrefix} couldn't make a ${SoundEntityClass} in code, so sounds are off until the map has a "${SoundTemplateName}"`);
  }
  return Spawned;
}
function IsValidEntity(Ent) {
  return Ent.IsValid();
}
function GetSoundSourceName(Pawn) {
  const Name = Pawn.GetEntityName();
  if (Name !== "") {
    return Name;
  }
  const NewName = `${SoundSourcePrefix}${GetPlayerSlot(Pawn)}`;
  Pawn.SetEntityName(NewName);
  return NewName;
}
function SpawnBeam(TemplateName, EndMarkerName, Start, End, Lifetime, FallbackColor) {
  const Spawned = SpawnBeamCopy(TemplateName, EndMarkerName, Start, End);
  if (!Spawned) {
    Instance2.DebugLine({ start: Start, end: End, duration: Lifetime, color: FallbackColor });
    return;
  }
  SetTimer(Lifetime, () => {
    RemoveBeamCopy(Spawned);
  });
}
function SpawnBeamCopy(TemplateName, EndMarkerName, Start, End) {
  const Template = FindPointTemplate(TemplateName);
  if (!Template) {
    return void 0;
  }
  const Spawned = Template.ForceSpawn(Start, VectorMath.GetRotation(VectorMath.Subtract(End, Start))) ?? [];
  for (const Ent of Spawned) {
    if (Ent.GetEntityName().startsWith(EndMarkerName)) {
      Ent.Teleport({ position: End });
    }
  }
  return Spawned;
}
function SpawnHeldBeam(TemplateName, EndMarkerName, Start, End, FallbackColor, RefireInterval = 0) {
  const Beam = { TemplateName, EndMarkerName, FallbackColor, Entities: [], RefireInterval, NextRefireTime: 0, Copies: [] };
  if (RefireInterval > 0) {
    MoveHeldBeam(Beam, Start, End);
    return Beam;
  }
  const Template = FindPointTemplate(TemplateName);
  if (Template) {
    Beam.Entities.push(...Template.ForceSpawn(Start, VectorMath.GetRotation(VectorMath.Subtract(End, Start))) ?? []);
  }
  PlaceHeldBeam(Beam, Start, End, true);
  return Beam;
}
function MoveHeldBeam(Beam, Start, End) {
  if (Beam.RefireInterval <= 0) {
    PlaceHeldBeam(Beam, Start, End, false);
    return;
  }
  const Now = Instance2.GetGameTime();
  for (let Index = Beam.Copies.length - 1; Index >= 0; Index--) {
    const Copy = Beam.Copies[Index];
    if (Copy && Copy.RemoveAt <= Now) {
      RemoveBeamCopy(Copy.Entities);
      Beam.Copies.splice(Index, 1);
    }
  }
  if (Now < Beam.NextRefireTime) {
    return;
  }
  const bOnSchedule = Now - Beam.NextRefireTime < Beam.RefireInterval;
  Beam.NextRefireTime = (bOnSchedule ? Beam.NextRefireTime : Now) + Beam.RefireInterval;
  const Spawned = SpawnBeamCopy(Beam.TemplateName, Beam.EndMarkerName, Start, End);
  if (Spawned) {
    Beam.Copies.push({ Entities: Spawned, RemoveAt: Now + Math.max(RefiredBeamLifetime, Beam.RefireInterval) });
  } else {
    Instance2.DebugLine({ start: Start, end: End, duration: Beam.RefireInterval, color: Beam.FallbackColor });
  }
}
function RemoveHeldBeam(Beam) {
  RemoveEntities(Beam.Entities);
  for (const Copy of Beam.Copies) {
    RemoveBeamCopy(Copy.Entities);
  }
  Beam.Copies.length = 0;
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
  const Template = FindPointTemplate(TemplateName);
  if (!Template) {
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
function RemoveBeamCopy(Entities8) {
  RemoveEntities(Entities8.filter((Ent) => {
    return Ent.IsValid() && Ent.GetEntityName().endsWith(BeamParticleSuffix);
  }));
  SetTimer(BeamFxLingerTime, () => {
    RemoveEntities(Entities8);
  });
}
function RemoveEntities(Entities8) {
  for (const Ent of Entities8) {
    if (Ent.IsValid()) {
      Ent.Remove();
    }
  }
}

// src/bm_buildings.ts
import { Instance as Instance4, Console as Console4 } from "cs_script/point_script";

// src/bm_hud.ts
import { Instance as Instance3, Console as Console3 } from "cs_script/point_script";
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
  const Now = Instance3.GetGameTime();
  if (Now - State.LastDamageTime > DamageBatchWindow) {
    State.DamageTotal = 0;
  }
  State.DamageTotal += Damage;
  State.LastDamageTime = Now;
  State.bDamagePopA = !State.bDamagePopA;
  Hud.SetDialogVariableStringForPlayer(Slot, DamageLabelId, "damage", `-${Math.round(State.DamageTotal)}`);
  SetTimer(DamageShowTime, () => {
    const LaterHud = FindDamageHud();
    if (LaterHud && Instance3.GetGameTime() - State.LastDamageTime >= DamageShowTime - 0.01) {
      LaterHud.SetDialogVariableStringForPlayer(Slot, DamageLabelId, "damage", "");
    }
  });
}
function ShowAirshot(Slot) {
  const Hud = FindDamageHud();
  if (!Hud) {
    return;
  }
  const Now = Instance3.GetGameTime();
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
  const Hud = FindEntityByName(DamageHudName);
  if (IsCustomHudLayout(Hud)) {
    return Hud;
  }
  if (!GbWarnedNoDamageHud) {
    GbWarnedNoDamageHud = true;
    const Problem = Hud ? "exists but isn't a custom_hud_layout" : "wasn't found";
    Console3.Log(`${LogPrefix} cannot find hud "${DamageHudName}" bc of ${Problem}`);
  }
  return void 0;
}
function IsCustomHudLayout(Ent) {
  return Ent !== void 0 && "SetDialogVariableStringForPlayer" in Ent && typeof Ent.SetDialogVariableStringForPlayer === "function";
}

// src/bm_buildings.ts
var EBuildHint = /* @__PURE__ */ ((EBuildHint2) => {
  EBuildHint2["Ready"] = "Ready";
  EBuildHint2["Placing"] = "Placing";
  EBuildHint2["Blocked"] = "Blocked";
  EBuildHint2["Full"] = "Full";
  EBuildHint2["Cooldown"] = "Cooldown";
  return EBuildHint2;
})(EBuildHint || {});
var BuildingKind = class {
  Settings;
  constructor(Settings) {
    this.Settings = Settings;
  }
  OnPlaced(Building, Now) {
  }
  GetBotSite() {
    return 0 /* NearEnemies */;
  }
  Tick(Building, Now, DeltaTime) {
  }
  // Taken away for any reason: destroyed, picked up, its owner changing class...
  OnRemoved(Building) {
  }
  // Only when it's broken (or its owner dies), after it's been removed
  OnDestroyed(Building) {
  }
  // Tints its model and debug box while set, e.g. a teleporter recharging. undefined = its team's colour.
  GetColor(Building, Now) {
    return void 0;
  }
  // A word or two for the owner's building panel
  GetStatus(Building, Now) {
    return "";
  }
};
var Axes = ["x", "y", "z"];
var PlacementGravity = 800;
var PlacementStepTime = 1 / 32;
var MaxPlacementSteps = 96;
var MaxPlacementSlopeDegrees = 45;
var MinGroundNormalZ = Math.cos(MaxPlacementSlopeDegrees * Math.PI / 180);
var PlacementLift = 2;
var PickUpRange = 150;
var MeleeReach = 80;
var MeleeRadius = 8;
var RepairBuildLockout = 1;
var DestroyFxLifetime = 5;
var ValidPlacementColor = { r: 90, g: 230, b: 120 };
var BlockedPlacementColor = { r: 255, g: 190, b: 40 };
var DestroyedDebugColor = { r: 255, g: 140, b: 0 };
var PreviewScale = 0.5;
var PreviewAlpha = 160;
var GBuildings = [];
var GPlacements = /* @__PURE__ */ new Map();
var GBuildingTraces = /* @__PURE__ */ new WeakMap();
var GRebuildTimes = /* @__PURE__ */ new Map();
var GLastRepairTimes = /* @__PURE__ */ new Map();
function TickBuildings(Now, DeltaTime) {
  for (const Building of [...GBuildings]) {
    if (Building.bRemoved) {
      continue;
    }
    if (!Building.Owner.IsValid()) {
      RemoveBuilding(Building);
      continue;
    }
    Building.Kind.Tick(Building, Now, DeltaTime);
    if (!Building.bRemoved) {
      const Color = GetBuildingColor(Building, Now);
      TintBuilding(Building, Color);
      if (Building.Models.length === 0) {
        DrawBuildingBox(Building.Position, Building.Kind.Settings, Color);
      }
    }
  }
}
function GetOwnedBuildings(Slot) {
  return GBuildings.filter((Building) => {
    return Building.OwnerSlot === Slot;
  });
}
function CountOwnedBuildings(Slot, Kind) {
  return GBuildings.filter((Building) => {
    return Building.OwnerSlot === Slot && Building.Kind === Kind;
  }).length;
}
function FindOwnedBuilding(Slot, Kind) {
  return GBuildings.find((Building) => {
    return Building.OwnerSlot === Slot && Building.Kind === Kind;
  });
}
function GetOwnedBuildingEntities(Pawn) {
  const Entities8 = [];
  for (const Building of GBuildings) {
    if (Building.Owner === Pawn) {
      Entities8.push(...GetModelEntities(Building.Models));
    }
  }
  return Entities8;
}
function GetBuildingEntities(Building) {
  return GetModelEntities(Building.Models);
}
function GetBuildingCenter(Building) {
  return VectorMath.Add(Building.Position, { x: 0, y: 0, z: Building.Kind.Settings.Height / 2 });
}
function IsBuildingEnemy(Building, Pawn) {
  return Pawn !== Building.Owner && (IsFreeForAll() || Pawn.GetTeamNumber() !== Building.Team);
}
function IsStandingOn(Building, Pawn, Reach, Above) {
  const Feet = Pawn.GetAbsOrigin();
  const Height = Feet.z - Building.Position.z;
  return Math.abs(Feet.x - Building.Position.x) <= Reach && Math.abs(Feet.y - Building.Position.y) <= Reach && Height >= -PlacementLift * 4 && Height <= Above;
}
function TurnBuilding(Building, Yaw) {
  Building.Yaw = Yaw;
  PlaceModels(Building.Models, Building.Position, Yaw, false);
}
function DamageBuilding(Building, Damage, Attacker) {
  if (Building.bRemoved || Damage <= 0) {
    return;
  }
  Building.Health -= Damage;
  const AttackerSlot = Attacker ? GetPlayerSlot(Attacker) : INDEX_NONE;
  if (AttackerSlot !== INDEX_NONE) {
    ShowDamageNumber(AttackerSlot, Damage);
  }
  if (Building.Health > 0) {
    return;
  }
  const Killer = Attacker ? GetPawnName(Attacker) : "something";
  Console4.Log(`${LogPrefix} ${Killer} destroyed ${GetPawnName(Building.Owner)}'s ${Building.Kind.Settings.DisplayName}`);
  DestroyBuilding(Building);
}
function RepairBuildingInReach(Pawn, Slot, Amount, Now) {
  const Building = FindFriendlyBuildingInReach(Pawn);
  if (!Building) {
    return;
  }
  const MaxHealth = Building.Kind.Settings.Health;
  const Repaired = Math.min(Amount, MaxHealth - Building.Health);
  if (Repaired <= 0) {
    if (IsInRepairLockout(Slot, Now)) {
      GLastRepairTimes.set(Slot, Now);
    }
    return;
  }
  Building.Health += Repaired;
  GLastRepairTimes.set(Slot, Now);
  Console4.Log(`${LogPrefix} ${GetPawnName(Pawn)} repaired ${GetPawnName(Building.Owner)}'s ${Building.Kind.Settings.DisplayName} (+${Math.round(Repaired)}, ${Math.round(Building.Health)}/${MaxHealth})`);
}
function IsRepairingBuilding(Pawn, Slot, Now) {
  if (IsInRepairLockout(Slot, Now)) {
    return true;
  }
  const Building = FindFriendlyBuildingInReach(Pawn);
  return Building !== void 0 && Building.Health < Building.Kind.Settings.Health;
}
function IsInRepairLockout(Slot, Now) {
  return Now - (GLastRepairTimes.get(Slot) ?? -Infinity) < RepairBuildLockout;
}
function FindFriendlyBuildingInReach(Pawn) {
  const Eye = Pawn.GetEyePosition();
  const End = VectorMath.Add(Eye, VectorMath.Scale(VectorMath.GetForwardVector(Pawn.GetEyeAngles()), MeleeReach));
  const Team = Pawn.GetTeamNumber();
  const Hit = TraceBuildings(Eye, End, MeleeRadius, (Building) => {
    return !Building.bRemoved && Building.Team === Team;
  });
  if (!Hit) {
    return void 0;
  }
  const Sight = Instance4.TraceLine({ start: Eye, end: Hit.Point, ignorePlayers: true, ignoreEntity: GetBuildingEntities(Hit.Building) });
  return Sight.didHit ? void 0 : Hit.Building;
}
function DestroyBuilding(Building) {
  if (Building.bRemoved) {
    return;
  }
  const Center = GetBuildingCenter(Building);
  const TemplateName = Building.Kind.Settings.DestroyFxTemplate;
  if (TemplateName === "" || !SpawnTemporaryTemplate(TemplateName, Center, DestroyFxLifetime)) {
    Instance4.DebugSphere({ center: Center, radius: Math.max(Building.Kind.Settings.Height, Building.Kind.Settings.HalfWidth), duration: 0.5, color: DestroyedDebugColor });
  }
  GetOrCreate(GRebuildTimes, Building.OwnerSlot, () => {
    return /* @__PURE__ */ new Map();
  }).set(Building.Kind, Instance4.GetGameTime() + Building.Kind.Settings.RebuildDelay);
  RemoveBuilding(Building);
  Building.Kind.OnDestroyed(Building);
}
function RemoveBuilding(Building) {
  if (Building.bRemoved) {
    return;
  }
  Building.bRemoved = true;
  RemoveModels(Building.Models);
  Building.Models = [];
  GBuildings = GBuildings.filter((Other) => {
    return Other !== Building;
  });
  Building.Kind.OnRemoved(Building);
}
function RemoveBuildings(Slot) {
  DropPlacement(Slot);
  for (const Building of GetOwnedBuildings(Slot)) {
    RemoveBuilding(Building);
  }
  GRebuildTimes.delete(Slot);
}
function ClearBuildings() {
  for (const Placement of GPlacements.values()) {
    RemoveModels(Placement.Preview);
  }
  GPlacements.clear();
  for (const Building of [...GBuildings]) {
    RemoveBuilding(Building);
  }
  GRebuildTimes.clear();
  GLastRepairTimes.clear();
}
function GetBuildingHudRows(Slot, Now) {
  return GetOwnedBuildings(Slot).map((Building) => {
    const Row = {
      Name: Building.Kind.Settings.DisplayName,
      Health: Math.max(0, Math.ceil(Building.Health)),
      MaxHealth: Building.Kind.Settings.Health,
      Status: Building.Kind.GetStatus(Building, Now)
    };
    return Row;
  });
}
function PlaceBuilding(Owner, Slot, Kind, Position, Yaw, Health, Now) {
  const Building = {
    Kind,
    Owner,
    OwnerSlot: Slot,
    Team: Owner.GetTeamNumber(),
    Position,
    Yaw,
    Health,
    DamageDealt: 0,
    Models: SpawnModels(Kind.Settings.ModelTemplate, Position),
    ColorKey: "",
    bRemoved: false
  };
  PlaceModels(Building.Models, Position, Yaw, true);
  GBuildings.push(Building);
  Kind.OnPlaced(Building, Now);
  TintBuilding(Building, GetBuildingColor(Building, Now));
  return Building;
}
function TickBuildTool(Pawn, Slot, Keys, bLeftPressed, bRightPressed, Now) {
  if (!Keys) {
    CancelPlacement(Slot);
    return;
  }
  if (bLeftPressed) {
    UseBuildKey(Pawn, Slot, Keys.Left.Kinds, Now);
  } else if (bRightPressed) {
    UseBuildKey(Pawn, Slot, Keys.Right.Kinds, Now);
  }
  TickPlacement(Slot);
}
function GetBuildHints(Slot, Keys, Now) {
  return { Left: GetBuildHint(Slot, Keys.Left, Now), Right: GetBuildHint(Slot, Keys.Right, Now) };
}
function GetBuildHint(Slot, Key, Now) {
  const Placement = GPlacements.get(Slot);
  if (Placement && Key.Kinds.includes(Placement.Kind)) {
    return { Name: Placement.Kind.Settings.DisplayName, Detail: "", State: Placement.bValid ? "Placing" /* Placing */ : "Blocked" /* Blocked */ };
  }
  const Next = GetNextToBuild(Slot, Key.Kinds);
  if (!Next) {
    return { Name: Key.Label, Detail: "", State: "Full" /* Full */ };
  }
  const Wait = GetRebuildWait(Slot, Next, Now);
  if (Wait > 0) {
    return { Name: Next.Settings.DisplayName, Detail: `${Math.ceil(Wait)}s`, State: "Cooldown" /* Cooldown */ };
  }
  const Left = Next.Settings.MaxCount - CountOwnedBuildings(Slot, Next);
  return { Name: Next.Settings.DisplayName, Detail: Left > 1 ? `x${Left}` : "", State: "Ready" /* Ready */ };
}
function GetRebuildWait(Slot, Kind, Now) {
  return Math.max(0, (GRebuildTimes.get(Slot)?.get(Kind) ?? 0) - Now);
}
function GetNextToBuild(Slot, Kinds) {
  return Kinds.find((Kind) => {
    return CountOwnedBuildings(Slot, Kind) < Kind.Settings.MaxCount;
  });
}
function UseBuildKey(Pawn, Slot, Kinds, Now) {
  const Placing = GetPlacingKind(Slot);
  if (Placing && Kinds.includes(Placing)) {
    ConfirmPlacement(Slot, Now);
    return;
  }
  if (Placing && IsCarryingBuilding(Slot)) {
    return;
  }
  const Eye = Pawn.GetEyePosition();
  const Reach = VectorMath.Add(Eye, VectorMath.Scale(VectorMath.GetForwardVector(GetAimAngles(Pawn)), PickUpRange));
  const InView = IsBotControlled(Pawn) ? void 0 : TraceBuildings(Eye, Reach, 0, (Building) => {
    return Building.OwnerSlot === Slot && Kinds.includes(Building.Kind);
  });
  if (InView) {
    PickUpBuilding(InView.Building);
    return;
  }
  const Next = GetNextToBuild(Slot, Kinds);
  if (Next && GetRebuildWait(Slot, Next, Now) <= 0) {
    StartPlacement(Pawn, Slot, Next);
  }
}
function GetPlacingKind(Slot) {
  return GPlacements.get(Slot)?.Kind;
}
function IsCarryingBuilding(Slot) {
  return GPlacements.get(Slot)?.Carried !== void 0;
}
function StartPlacement(Owner, Slot, Kind) {
  CancelPlacement(Slot);
  GPlacements.set(Slot, MakePlacement(Owner, Kind, void 0));
  TickPlacement(Slot);
}
function PickUpBuilding(Building) {
  const Slot = Building.OwnerSlot;
  CancelPlacement(Slot);
  RemoveBuilding(Building);
  GPlacements.set(Slot, MakePlacement(Building.Owner, Building.Kind, Building));
  TickPlacement(Slot);
  Console4.Log(`${LogPrefix} ${GetPawnName(Building.Owner)} picked up their ${Building.Kind.Settings.DisplayName}`);
}
function TickPlacement(Slot) {
  const Placement = GPlacements.get(Slot);
  if (!Placement) {
    return;
  }
  if (!Placement.Owner.IsValid()) {
    CancelPlacement(Slot);
    return;
  }
  UpdatePlacementSpot(Placement);
  PlaceModels(Placement.Preview, Placement.Position, Placement.Yaw, false);
  const Color = Placement.bValid ? ValidPlacementColor : BlockedPlacementColor;
  if (Placement.bPreviewTintedValid !== Placement.bValid) {
    Placement.bPreviewTintedValid = Placement.bValid;
    for (const Model of Placement.Preview) {
      if (Model.Ent.IsValid() && IsModelEntity(Model.Ent)) {
        Model.Ent.SetColor({ ...Color, a: PreviewAlpha });
      }
    }
  }
  for (let Index = 1; Index < Placement.Path.length; Index++) {
    const From = Placement.Path[Index - 1];
    const To = Placement.Path[Index];
    if (From && To) {
      Instance4.DebugLine({ start: From, end: To, duration: TickInterval * 2, color: Color });
    }
  }
  DrawBuildingBox(Placement.Position, Placement.Kind.Settings, Color);
}
function ConfirmPlacement(Slot, Now) {
  const Placement = GPlacements.get(Slot);
  if (!Placement) {
    return void 0;
  }
  UpdatePlacementSpot(Placement);
  if (!Placement.bValid) {
    return void 0;
  }
  GPlacements.delete(Slot);
  RemoveModels(Placement.Preview);
  const Health = Placement.Carried ? Placement.Carried.Health : Placement.Kind.Settings.Health;
  const Building = PlaceBuilding(Placement.Owner, Slot, Placement.Kind, Placement.Position, Placement.Yaw, Health, Now);
  Console4.Log(`${LogPrefix} ${GetPawnName(Placement.Owner)} built a ${Placement.Kind.Settings.DisplayName}`);
  return Building;
}
function CancelPlacement(Slot) {
  const Placement = GPlacements.get(Slot);
  if (!Placement) {
    return;
  }
  GPlacements.delete(Slot);
  RemoveModels(Placement.Preview);
  const Carried = Placement.Carried;
  if (Carried && Carried.Owner.IsValid()) {
    PlaceBuilding(Carried.Owner, Carried.OwnerSlot, Carried.Kind, Carried.Position, Carried.Yaw, Carried.Health, Instance4.GetGameTime());
  }
}
function DropPlacement(Slot) {
  const Placement = GPlacements.get(Slot);
  if (Placement) {
    RemoveModels(Placement.Preview);
    GPlacements.delete(Slot);
  }
}
function MakePlacement(Owner, Kind, Carried) {
  const Position = Owner.GetAbsOrigin();
  return { Kind, Owner, Carried, Preview: SpawnPreview(Kind, Position), Path: [], Position, Yaw: 0, bValid: false, bPreviewTintedValid: void 0 };
}
function SpawnPreview(Kind, Position) {
  const Preview = SpawnModels(Kind.Settings.ModelTemplate, Position);
  for (const Model of Preview) {
    if (!IsModelEntity(Model.Ent)) {
      continue;
    }
    Model.Ent.FireInput({ input: "DisableCollision" });
    if (Model.Ent.GetParent() === void 0) {
      Model.Ent.SetModelScale(PreviewScale);
    }
  }
  return Preview;
}
function UpdatePlacementSpot(Placement) {
  const Settings = Placement.Kind.Settings;
  const Owner = Placement.Owner;
  const Aim = GetAimAngles(Owner);
  const Ignored = [Owner, ...GetModelEntities(Placement.Preview)];
  let Position = Owner.GetEyePosition();
  let Velocity = VectorMath.Scale(VectorMath.GetForwardVector(Aim), Settings.ThrowSpeed);
  let Ground = void 0;
  const Path = [Position];
  for (let Step = 0; Step < MaxPlacementSteps && !Ground; Step++) {
    Velocity = { x: Velocity.x, y: Velocity.y, z: Velocity.z - PlacementGravity * PlacementStepTime };
    const Next = VectorMath.Add(Position, VectorMath.Scale(Velocity, PlacementStepTime));
    const Trace = Instance4.TraceLine({ start: Position, end: Next, ignoreEntity: Ignored, ignorePlayers: true });
    if (!Trace.didHit) {
      Position = Next;
      Path.push(Next);
      continue;
    }
    Path.push(Trace.end);
    if (!Trace.startedInSolid && Trace.normal.z >= MinGroundNormalZ) {
      Ground = Trace;
      break;
    }
    Position = VectorMath.Add(Trace.end, VectorMath.Scale(Trace.normal, Settings.HalfWidth + PlacementLift));
    Velocity = { x: 0, y: 0, z: Math.min(0, Velocity.z) };
  }
  Placement.Path = Path;
  Placement.Position = Ground ? Ground.end : Position;
  Placement.Yaw = Aim.yaw;
  Placement.bValid = Ground !== void 0 && HasRoom(Ground.end, Ground.normal, Settings, GetModelEntities(Placement.Preview)) && !OverlapsBuilding(Ground.end, Settings);
}
function HasRoom(Position, GroundNormal, Settings, Ignored) {
  const SlopeRise = Settings.HalfWidth * Math.SQRT2 * Math.sqrt(Math.max(0, 1 - GroundNormal.z * GroundNormal.z)) / Math.max(0.01, GroundNormal.z);
  const Lift = SlopeRise + PlacementLift;
  if (Lift >= Settings.Height) {
    return true;
  }
  const Start = VectorMath.Add(Position, { x: 0, y: 0, z: Lift });
  const Trace = Instance4.TraceBox(
    {
      start: Start,
      end: VectorMath.Add(Start, { x: 0, y: 0, z: 1 }),
      mins: { x: -Settings.HalfWidth, y: -Settings.HalfWidth, z: 0 },
      maxs: { x: Settings.HalfWidth, y: Settings.HalfWidth, z: Settings.Height - Lift },
      ignoreEntity: Ignored,
      ignorePlayers: false
    }
  );
  return !Trace.didHit && !Trace.startedInSolid;
}
function OverlapsBuilding(Position, Settings) {
  return GBuildings.some((Building) => {
    const Other = Building.Kind.Settings;
    const Reach = Settings.HalfWidth + Other.HalfWidth;
    return Math.abs(Position.x - Building.Position.x) < Reach && Math.abs(Position.y - Building.Position.y) < Reach && Position.z < Building.Position.z + Other.Height && Building.Position.z < Position.z + Settings.Height;
  });
}
function TraceBuildings(Start, End, Radius, Filter) {
  let Best = void 0;
  for (const Building of GBuildings) {
    if (!Filter(Building)) {
      continue;
    }
    const Settings = Building.Kind.Settings;
    const Mins = VectorMath.Add(Building.Position, { x: -Settings.HalfWidth - Radius, y: -Settings.HalfWidth - Radius, z: -Radius });
    const Maxs = VectorMath.Add(Building.Position, { x: Settings.HalfWidth + Radius, y: Settings.HalfWidth + Radius, z: Settings.Height + Radius });
    const Hit = IntersectSegmentBox(Start, End, Mins, Maxs);
    if (Hit && (!Best || Hit.Fraction < Best.Fraction)) {
      const Point = VectorMath.Add(Start, VectorMath.Scale(VectorMath.Subtract(End, Start), Hit.Fraction));
      Best = { Building, Fraction: Hit.Fraction, Point, Normal: Hit.Normal };
    }
  }
  return Best;
}
function FindBuildingOnLine(Attacker, Start, End, Trace) {
  const Struck = GetTraceBuilding(Trace);
  if (Trace && Struck && IsBuildingEnemy(Struck, Attacker)) {
    return { Building: Struck, Fraction: Trace.fraction, Point: Trace.end, Normal: Trace.normal };
  }
  return TraceBuildings(Start, End, 0, (Building) => {
    return IsBuildingEnemy(Building, Attacker);
  });
}
function ClipTraceToBuildings(Trace, Start, End, Radius, Owner) {
  const Hit = TraceBuildings(Start, End, Radius, (Building) => {
    return IsBuildingEnemy(Building, Owner);
  });
  if (!Hit || Trace.didHit && Trace.fraction <= Hit.Fraction) {
    return Trace;
  }
  const Clipped = { fraction: Hit.Fraction, end: Hit.Point, didHit: true, startedInSolid: false, normal: Hit.Normal };
  GBuildingTraces.set(Clipped, Hit.Building);
  return Clipped;
}
function GetTraceBuilding(Trace) {
  if (!Trace) {
    return void 0;
  }
  return GBuildingTraces.get(Trace) ?? GetBuildingByEntity(Trace.hitEntity);
}
function DamageTracedBuilding(Trace, Damage, Attacker) {
  const Building = GetTraceBuilding(Trace);
  if (!Building || !IsBuildingEnemy(Building, Attacker)) {
    return false;
  }
  DamageBuilding(Building, Damage, Attacker);
  return true;
}
function DamageBuildingsInRadius(Origin, Radius, Damage, Attacker) {
  for (const Building of [...GBuildings]) {
    if (Building.bRemoved || !IsBuildingEnemy(Building, Attacker)) {
      continue;
    }
    const Settings = Building.Kind.Settings;
    const Nearest = {
      x: Math.min(Math.max(Origin.x, Building.Position.x - Settings.HalfWidth), Building.Position.x + Settings.HalfWidth),
      y: Math.min(Math.max(Origin.y, Building.Position.y - Settings.HalfWidth), Building.Position.y + Settings.HalfWidth),
      z: Math.min(Math.max(Origin.z, Building.Position.z), Building.Position.z + Settings.Height)
    };
    const Distance = VectorMath.Size(VectorMath.Subtract(Nearest, Origin));
    if (Distance > Radius) {
      continue;
    }
    const Sight = Instance4.TraceLine({ start: Origin, end: GetBuildingCenter(Building), ignorePlayers: true, ignoreEntity: GetBuildingEntities(Building) });
    if (Sight.didHit && !Sight.startedInSolid) {
      continue;
    }
    DamageBuilding(Building, Damage * (1 - 0.5 * (Distance / Radius)), Attacker);
  }
}
function GetBuildingByEntity(Ent) {
  if (!Ent) {
    return void 0;
  }
  return GBuildings.find((Building) => {
    return Building.Models.some((Model) => {
      return Model.Ent === Ent;
    });
  });
}
function IntersectSegmentBox(Start, End, Mins, Maxs) {
  const Delta = VectorMath.Subtract(End, Start);
  let Enter = 0;
  let Exit = 1;
  let Normal = VectorMath.Scale(VectorMath.GetSafeNormal(Delta), -1);
  for (const Axis of Axes) {
    if (Math.abs(Delta[Axis]) < 1e-6) {
      if (Start[Axis] < Mins[Axis] || Start[Axis] > Maxs[Axis]) {
        return void 0;
      }
      continue;
    }
    let Near = (Mins[Axis] - Start[Axis]) / Delta[Axis];
    let Far = (Maxs[Axis] - Start[Axis]) / Delta[Axis];
    let Facing = -1;
    if (Near > Far) {
      [Near, Far] = [Far, Near];
      Facing = 1;
    }
    if (Near > Enter) {
      Enter = Near;
      Normal = { x: Axis === "x" ? Facing : 0, y: Axis === "y" ? Facing : 0, z: Axis === "z" ? Facing : 0 };
    }
    Exit = Math.min(Exit, Far);
    if (Enter > Exit) {
      return void 0;
    }
  }
  return { Fraction: Enter, Normal };
}
function SpawnModels(TemplateName, Position) {
  if (TemplateName === "") {
    return [];
  }
  return SpawnTemplateEntities(TemplateName, Position, void 0).map((Ent) => {
    return { Ent, LocalRotation: RotationMath.FromRotator(Ent.GetAbsAngles()) };
  });
}
function PlaceModels(Models, Position, Yaw, bTeleport) {
  const Facing = RotationMath.FromRotator({ pitch: 0, yaw: Yaw, roll: 0 });
  for (const Model of Models) {
    if (!Model.Ent.IsValid() || Model.Ent.GetParent() !== void 0) {
      continue;
    }
    const Placement = { position: Position, angles: RotationMath.ToRotator(RotationMath.Multiply(Facing, Model.LocalRotation)) };
    if (bTeleport) {
      Model.Ent.Teleport(Placement);
    } else {
      Model.Ent.Move(Placement);
    }
  }
}
function GetBuildingColor(Building, Now) {
  return Building.Kind.GetColor(Building, Now) ?? GetColorForTeam(Building.Team);
}
function TintBuilding(Building, Color) {
  const Key = `${Color.r},${Color.g},${Color.b}`;
  if (Key === Building.ColorKey) {
    return;
  }
  Building.ColorKey = Key;
  for (const Model of Building.Models) {
    if (Model.Ent.IsValid() && IsModelEntity(Model.Ent)) {
      Model.Ent.SetColor(Color);
    }
  }
}
function RemoveModels(Models) {
  for (const Model of Models) {
    if (Model.Ent.IsValid()) {
      Model.Ent.Remove();
    }
  }
}
function GetModelEntities(Models) {
  return Models.filter((Model) => {
    return Model.Ent.IsValid();
  }).map((Model) => {
    return Model.Ent;
  });
}
function DrawBuildingBox(Position, Settings, Color) {
  Instance4.DebugBox(
    {
      mins: VectorMath.Add(Position, { x: -Settings.HalfWidth, y: -Settings.HalfWidth, z: 0 }),
      maxs: VectorMath.Add(Position, { x: Settings.HalfWidth, y: Settings.HalfWidth, z: Settings.Height }),
      duration: TickInterval * 2,
      color: Color
    }
  );
}

// src/bm_combat.ts
var Gravity = 800;
var ExplosionTemplateName = "boom_template";
var ExplosionFxLifetime = 5;
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
var MinGroundNormalZ2 = 0.7;
var GroundProbeDistance = 8;
var MinFacingSpeed = 1;
var MissingProjectileRadius = 3;
var AimPointPasses = 3;
var GShootables = [];
function LaunchProjectile(Owner, Speed, UpSpeed, GravityScale, TemplateName, Radius = 0, Shape = "sphere" /* Sphere */) {
  const Direction = VectorMath.GetForwardVector(GetAimAngles(Owner));
  const Start = Owner.GetEyePosition();
  const Velocity = VectorMath.Add(VectorMath.Scale(Direction, Speed), { x: 0, y: 0, z: UpSpeed });
  const Projectile = {
    Owner,
    Start,
    Radius,
    Shape,
    Position: Start,
    Velocity,
    GravityScale,
    SpawnedAt: Instance5.GetGameTime(),
    Models: TemplateName !== void 0 ? SpawnProjectileModels(TemplateName, Start) : [],
    bDestroyed: false
  };
  PlaceProjectileModels(Projectile, true);
  TintProjectile(Projectile, GetTeamColor(Owner));
  return Projectile;
}
function GetAimPoint(Start, Target, TargetVelocity, Ballistics) {
  if (!Ballistics || Ballistics.Speed <= 0) {
    return Target;
  }
  let Lead = Target;
  let Time = 0;
  for (let Pass = 0; Pass < AimPointPasses; Pass++) {
    Time = VectorMath.Size(VectorMath.Subtract(Lead, Start)) / Ballistics.Speed;
    Lead = VectorMath.Add(Target, VectorMath.Scale(TargetVelocity, Time));
  }
  const Drop = 0.5 * Gravity * Ballistics.GravityScale * Time * Time - Ballistics.UpSpeed * Time;
  return { x: Lead.x, y: Lead.y, z: Lead.z + Drop };
}
function MoveProjectile(Projectile, DeltaTime, bHitPlayers) {
  const Velocity = Projectile.Velocity;
  Projectile.Velocity = { x: Velocity.x, y: Velocity.y, z: Velocity.z - Gravity * Projectile.GravityScale * DeltaTime };
  const Hit = SweepProjectile(Projectile, DeltaTime, bHitPlayers);
  PlaceProjectileModels(Projectile, false);
  return Hit;
}
function StepImpactProjectile(Projectile, Now, DeltaTime, Lifetime, OnImpact) {
  if (IsProjectileExpired(Projectile, Now, Lifetime)) {
    DestroyProjectile(Projectile);
    return false;
  }
  const Hit = MoveProjectile(Projectile, DeltaTime, true);
  if (Hit) {
    DestroyProjectile(Projectile);
    OnImpact(Hit);
    return false;
  }
  DrawMissingProjectile(Projectile);
  return true;
}
function EmbedProjectile(Projectile, Hit, Depth) {
  const Contact = VectorMath.Subtract(Hit.end, VectorMath.Scale(Hit.normal, Projectile.Radius));
  const Embedded = VectorMath.Add(Contact, VectorMath.Scale(VectorMath.GetSafeNormal(Projectile.Velocity), Depth));
  PlaceProjectileModels({ ...Projectile, Position: Embedded }, false);
  Projectile.Velocity = { x: 0, y: 0, z: 0 };
}
function IsProjectileExpired(Projectile, Now, Lifetime) {
  return !Projectile.Owner.IsValid() || Now - Projectile.SpawnedAt > Lifetime;
}
function DrawMissingProjectile(Projectile, Color = GetTeamColor(Projectile.Owner)) {
  const Radius = Projectile.Radius > 0 ? Projectile.Radius : MissingProjectileRadius;
  if (Projectile.Shape === "box" /* Box */) {
    const Extent = GetBoxExtent(Radius);
    Instance5.DebugBox({ mins: VectorMath.Subtract(Projectile.Position, Extent), maxs: VectorMath.Add(Projectile.Position, Extent), duration: TickInterval * 2, color: Color });
    return;
  }
  Instance5.DebugSphere({ center: Projectile.Position, radius: Radius, duration: TickInterval * 2, color: Color });
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
function MovePiercingProjectile(Projectile, DeltaTime) {
  const Velocity = Projectile.Velocity;
  Projectile.Velocity = { x: Velocity.x, y: Velocity.y, z: Velocity.z - Gravity * Projectile.GravityScale * DeltaTime };
  const End = VectorMath.Add(Projectile.Position, VectorMath.Scale(Projectile.Velocity, DeltaTime));
  const Ignored = [...GetIgnoredEntities(Projectile), ...Projectile.HitPlayers];
  const NewHits = [];
  let WorldHit = void 0;
  for (let TraceCount = 0; TraceCount < MaxHitscanTraces; TraceCount++) {
    const Trace = TraceProjectile(Projectile, End, Ignored, true);
    if (!Trace.didHit) {
      break;
    }
    const Victim = Trace.hitEntity;
    if (!IsPlayerPawn(Victim)) {
      WorldHit = Trace;
      break;
    }
    Ignored.push(Victim);
    if (Victim.IsAlive()) {
      Projectile.HitPlayers.add(Victim);
      NewHits.push({ Victim, Trace });
    }
  }
  Projectile.Position = WorldHit ? VectorMath.Add(WorldHit.end, VectorMath.Scale(WorldHit.normal, SurfaceGap)) : End;
  PlaceProjectileModels(Projectile, false);
  return { NewHits, WorldHit };
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
  if (Normal.z >= MinGroundNormalZ2 && OutSpeed < Bounce.SettleSpeed) {
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
  const Trace = Instance5.TraceLine(
    {
      start: Projectile.Position,
      end: VectorMath.Add(Projectile.Position, { x: 0, y: 0, z: -(SurfaceGap + GroundProbeDistance) }),
      ignoreEntity: GetIgnoredEntities(Projectile),
      ignorePlayers: true
    }
  );
  if (!Trace.didHit || Trace.normal.z < MinGroundNormalZ2) {
    Projectile.GroundNormal = void 0;
    return;
  }
  Projectile.Position = VectorMath.Add(Trace.end, VectorMath.Scale(Trace.normal, SurfaceGap));
  Projectile.GroundNormal = Trace.normal;
  Projectile.Velocity = VectorMath.ProjectOnPlane(Projectile.Velocity, Trace.normal);
}
function SweepProjectile(Projectile, DeltaTime, bHitPlayers) {
  const NextPosition = VectorMath.Add(Projectile.Position, VectorMath.Scale(Projectile.Velocity, DeltaTime));
  const Trace = TraceProjectile(Projectile, NextPosition, GetIgnoredEntities(Projectile), bHitPlayers);
  if (Trace.didHit) {
    Projectile.Position = VectorMath.Add(Trace.end, VectorMath.Scale(Trace.normal, SurfaceGap));
  } else {
    Projectile.Position = NextPosition;
  }
  return Trace.didHit ? Trace : void 0;
}
function TraceProjectile(Projectile, End, Ignored, bHitPlayers) {
  return ClipTraceToBuildings(TraceProjectileShape(Projectile, End, Ignored, bHitPlayers), Projectile.Position, End, Projectile.Radius, Projectile.Owner);
}
function TraceProjectileShape(Projectile, End, Ignored, bHitPlayers) {
  const Trace = { start: Projectile.Position, end: End, ignoreEntity: Ignored, ignorePlayers: !bHitPlayers };
  if (Projectile.Radius <= 0) {
    return Instance5.TraceLine(Trace);
  }
  if (Projectile.Shape === "box" /* Box */) {
    const Extent = GetBoxExtent(Projectile.Radius);
    return Instance5.TraceBox({ ...Trace, mins: VectorMath.Scale(Extent, -1), maxs: Extent });
  }
  return Instance5.TraceSphere({ ...Trace, radius: Projectile.Radius });
}
function GetBoxExtent(HalfSize) {
  return { x: HalfSize, y: HalfSize, z: HalfSize };
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
  Projectile.bDestroyed = true;
  for (const Model of Projectile.Models) {
    if (Model.Ent.IsValid()) {
      Model.Ent.Remove();
    }
  }
  Projectile.Models = [];
}
function MakeShootable(Projectile, HitRadius, Weight, OnKnocked) {
  GShootables.push({ Projectile, HitRadius, Weight, OnKnocked });
}
function GetEnemyShootables(Shooter) {
  GShootables = GShootables.filter((Shootable) => {
    return !Shootable.Projectile.bDestroyed;
  });
  return GShootables.filter((Shootable) => {
    const Owner = Shootable.Projectile.Owner;
    return Owner.IsValid() && Owner !== Shooter && !IsTeammate(Owner, Shooter);
  });
}
function ShootDownProjectiles(Shooter, Start, End) {
  for (const Shootable of GetEnemyShootables(Shooter)) {
    const Position = Shootable.Projectile.Position;
    if (VectorMath.Size(VectorMath.Subtract(Position, VectorMath.ClosestPointOnSegment(Position, Start, End))) <= Shootable.HitRadius) {
      DestroyProjectile(Shootable.Projectile);
      Console5.Log(`${LogPrefix} ${GetPawnName(Shooter)} shot down a projectile of ${GetPawnName(Shootable.Projectile.Owner)}`);
    }
  }
}
function KnockProjectiles(Origin, Attacker, Radius, Damage, Knockback) {
  for (const Shootable of GetEnemyShootables(Attacker)) {
    const Offset = VectorMath.Subtract(Shootable.Projectile.Position, Origin);
    const Distance = VectorMath.Size(Offset);
    if (Distance > Radius) {
      continue;
    }
    const Sight = Instance5.TraceLine({ start: Origin, end: Shootable.Projectile.Position, ignorePlayers: true });
    if (Sight.didHit && !Sight.startedInSolid) {
      continue;
    }
    const Away = Distance > 1 ? VectorMath.GetSafeNormal(Offset) : UpVector;
    const Speed = Damage * (1 - 0.5 * (Distance / Radius)) * Knockback / (StandingKnockbackHeight * Shootable.Weight);
    Shootable.OnKnocked(VectorMath.Scale(VectorMath.GetSafeNormal(VectorMath.Add(Away, GroundedKnockbackLift)), Speed));
  }
}
function DestroyProjectiles(Projectiles) {
  for (const Projectile of Projectiles) {
    DestroyProjectile(Projectile);
  }
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
function Explode(Position, Attacker, Radius, Damage, Knockback, RangeFalloff, FxTemplate = ExplosionTemplateName) {
  const Origin = VectorMath.Add(Position, ExplosionOffset);
  SpawnExplosionFx(Position, Radius, FxTemplate);
  if (!Attacker.IsValid()) {
    return 0;
  }
  DamageBuildingsInRadius(Origin, Radius, Damage, Attacker);
  KnockProjectiles(Origin, Attacker, Radius, Damage, Knockback);
  let DamageTotal = 0;
  ForEachLivePawn((Victim) => {
    const Target = GetChestPosition(Victim);
    const Offset = VectorMath.Subtract(Target, Origin);
    const Distance = VectorMath.Size(Offset);
    if (Distance > Radius) {
      return;
    }
    const Trace = Instance5.TraceLine({ start: Origin, end: Target, ignorePlayers: true });
    if (Trace.didHit && !Trace.startedInSolid) {
      return;
    }
    const bIsSelf = Victim === Attacker;
    if (!bIsSelf && IsTeammate(Victim, Attacker)) {
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
      DamageTotal += DamageDealt;
      SpawnBloodSplatter(Origin, Victim);
    }
    const PushDirection = VectorMath.GetSafeNormal(Push);
    Console5.Log(`${LogPrefix} ${GetPawnName(Attacker)} Damaged (explosive) ${GetPawnName(Victim)} : ${DamageTaken}d : ${VectorMath.Size(Push)}k (${PushDirection.x}, ${PushDirection.y}, ${PushDirection.z}) : ${Falloff}f : ${RangeScale.toFixed(2)}r`);
  });
  return DamageTotal;
}
function SpawnExplosionFx(Position, Radius, FxTemplate = ExplosionTemplateName) {
  const Origin = VectorMath.Add(Position, ExplosionOffset);
  const Fx = SpawnTemporaryTemplate(FxTemplate, Origin, ExplosionFxLifetime) ?? SpawnTemporaryTemplate(ExplosionTemplateName, Origin, ExplosionFxLifetime);
  if (!Fx) {
    Instance5.DebugSphere({ center: Origin, radius: Radius, duration: 0.3, color: ExplosionDebugColor });
  }
  SpawnScorchMark(Position);
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
  const Ignored = [Shooter, ...GetOwnedBuildingEntities(Shooter)];
  const Hits = [];
  let StopPoint = End;
  let WorldTrace = void 0;
  for (let TraceCount = 0; TraceCount < MaxHitscanTraces; TraceCount++) {
    const Trace = Instance5.TraceLine({ start: Start, end: End, ignoreEntity: Ignored, traceHitboxes: true });
    if (!Trace.didHit) {
      StopPoint = End;
      break;
    }
    StopPoint = Trace.end;
    const Victim = Trace.hitEntity;
    if (!IsPlayerPawn(Victim)) {
      WorldTrace = Trace;
      break;
    }
    Ignored.push(Victim);
    if (!Victim.IsAlive() || IsTeammate(Victim, Shooter)) {
      continue;
    }
    Hits.push({ Victim, Trace });
    if (Hits.length >= MaxHits) {
      break;
    }
  }
  const Building = FindBuildingOnLine(Shooter, Start, StopPoint, WorldTrace);
  ShootDownProjectiles(Shooter, Start, Building ? Building.Point : StopPoint);
  if (!Building) {
    return { Hits, End: StopPoint, HitBuilding: void 0 };
  }
  const Reach = VectorMath.Size(VectorMath.Subtract(Building.Point, Start));
  const HitsBefore = Hits.filter((Hit) => {
    return VectorMath.Size(VectorMath.Subtract(Hit.Trace.end, Start)) <= Reach;
  });
  return { Hits: HitsBefore, End: Building.Point, HitBuilding: Building.Building };
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
  const Trace = Instance5.TraceLine(
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

// src/bm_launcher.ts
import { Instance as Instance6, GameRules, CSInputs, CSGearSlot } from "cs_script/point_script";
var FireFxLifetime = 3;
var ReloadFxLifetime = 3;
var RealGunSlots = [CSGearSlot.RIFLE, CSGearSlot.PISTOL];
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
      ChargeStartTime: void 0,
      DrawnAt: void 0
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
  const Active = GetHeldWeapon(Pawn);
  let Shot = void 0;
  for (const State of Launchers) {
    const Weapon = EmptyRealGun(Pawn, State.WeaponName);
    if (!Weapon || Active !== Weapon) {
      State.NextReloadTime = void 0;
      State.ChargeStartTime = void 0;
      State.DrawnAt = void 0;
      continue;
    }
    State.DrawnAt ??= Now;
    if (Now - State.DrawnAt < State.Settings.DeployTime) {
      continue;
    }
    Shot = TickHeldLauncher(Pawn, State, Now) ?? Shot;
  }
  return Shot;
}
function GetLauncherAmmo(Pawn, Slot) {
  const Launchers = GLaunchers.get(Slot);
  const Active = GetHeldWeapon(Pawn);
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
  const bCanFire = !Pawn.IsBuyMenuOpen() && !GameRules.IsFreezePeriod();
  const bMainHeld = bCanFire && IsInputDown(Pawn, CSInputs.ATTACK);
  const bAltFire = bCanFire && !bMainHeld && State.Settings.AltFireInterval !== void 0 && IsInputDown(Pawn, CSInputs.ATTACK2);
  if ((bMainHeld || bAltFire) && State.Clip > 0) {
    State.NextReloadTime = void 0;
    if (Now < State.NextFireTime) {
      State.ChargeStartTime = void 0;
      return void 0;
    }
    if (bMainHeld && State.Settings.ChargeTime > 0) {
      if (State.ChargeStartTime === void 0) {
        State.ChargeStartTime = Now;
      }
      if (Now - State.ChargeStartTime < State.Settings.ChargeTime) {
        return void 0;
      }
    }
    return FireLauncher(Pawn, State, Now, bAltFire, bMainHeld && State.Settings.ChargeTime > 0 ? 1 : 0);
  }
  if (State.Settings.bFireOnRelease && State.ChargeStartTime !== void 0 && bCanFire) {
    return FireLauncher(Pawn, State, Now, false, GetChargeFraction(State));
  }
  State.ChargeStartTime = void 0;
  TickReload(Pawn, State, Now);
  return void 0;
}
function FireLauncher(Pawn, State, Now, bAltFire, ChargeFraction) {
  State.ChargeStartTime = void 0;
  State.Clip--;
  const Interval = bAltFire ? State.Settings.AltFireInterval ?? State.Settings.FireInterval : State.Settings.FireInterval;
  const bHeldThrough = Now - State.NextFireTime < TickInterval * 1.5;
  State.NextFireTime = (bHeldThrough ? State.NextFireTime : Now) + Interval;
  SpawnFireFx(Pawn, bAltFire ? State.Settings.AltFireFxTemplate ?? State.Settings.FireFxTemplate : State.Settings.FireFxTemplate);
  PlaySoundOn(bAltFire ? State.Settings.AltFireSound ?? State.Settings.FireSound : State.Settings.FireSound, Pawn);
  return { WeaponName: State.WeaponName, bAltFire, ChargeFraction };
}
function GetChargeFraction(State) {
  if (State.ChargeStartTime === void 0 || State.Settings.ChargeTime <= 0) {
    return 0;
  }
  return Math.min(1, (Instance6.GetGameTime() - State.ChargeStartTime) / State.Settings.ChargeTime);
}
function GetReloadFraction(State) {
  if (State.NextReloadTime === void 0) {
    return 0;
  }
  return GetWaitFraction(State.ReloadStartTime, State.NextReloadTime, Instance6.GetGameTime());
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
  PlaySoundOn(State.Settings.ReloadSound, Pawn);
  State.ReloadStartTime = Now;
  State.NextReloadTime = CanReload(State) ? Now + State.Settings.ReloadEachTime : void 0;
}
function CanReload(State) {
  return State.Clip < State.Settings.ClipSize;
}
function EmptyRealGuns(Pawn) {
  for (const GearSlot of RealGunSlots) {
    const Weapon = Pawn.FindWeaponBySlot(GearSlot);
    if (Weapon) {
      EmptyGun(Weapon);
    }
  }
}
function EmptyRealGun(Pawn, WeaponName) {
  const Weapon = Pawn.FindWeapon(WeaponName);
  if (Weapon) {
    EmptyGun(Weapon);
  }
  return Weapon;
}
function EmptyGun(Weapon) {
  if (Weapon.GetClipAmmo() !== 0) {
    Weapon.SetClipAmmo(0);
  }
  if (Weapon.GetReserveAmmo() !== 0) {
    Weapon.SetReserveAmmo(0);
  }
}
function SpawnFireFx(Pawn, TemplateName) {
  if (TemplateName !== "") {
    SpawnTemporaryTemplate(TemplateName, Pawn.GetEyePosition(), FireFxLifetime);
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
  EPlayerClass2["Boxer"] = "boxer";
  EPlayerClass2["Shocker"] = "shocker";
  EPlayerClass2["Shrinker"] = "shrinker";
  EPlayerClass2["Gunner"] = "builder";
  return EPlayerClass2;
})(EPlayerClass || {});
var TF2RocketFalloff = { RampUp: 1.25, FallOff: 0.5, OptimalDistance: 512 };
var TF2PipeFalloff = { RampUp: 1, FallOff: 0.9, OptimalDistance: 512 };
var BeamerShotgunFalloff = [
  { Distance: 0, Scale: 1 },
  { Distance: 256, Scale: 1 },
  { Distance: 1024, Scale: 0.3 }
];
var PlayableClasses = Object.values(EPlayerClass).filter((PlayerClass3) => {
  return PlayerClass3 !== "none" /* None */;
});
var MaxBeamHits = 8;
var ProjectileBotRange = 4096;
var DefaultHealth = 100;
var DefaultSizeScale = 1;
var StrippedGearSlots = [CSGearSlot2.RIFLE, CSGearSlot2.PISTOL, CSGearSlot2.KNIFE, CSGearSlot2.GRENADES];
var NoClassStrippedGearSlots = [CSGearSlot2.RIFLE, CSGearSlot2.PISTOL, CSGearSlot2.GRENADES];
var NoClassMelee = "weapon_knife";
var FallbackMelee = "weapon_knife";
var PickFxLifetime = 3;
var GOwnModels = /* @__PURE__ */ new Map();
var GClassModels = /* @__PURE__ */ new Set();
var GWarnedModels = /* @__PURE__ */ new Set();
var UntintedColor = { r: 255, g: 255, b: 255 };
var BeamStartDrop = { x: 0, y: 0, z: 12 };
function ApplyBody(Pawn, Health, SizeScale, Model) {
  Pawn.SetMaxHealth(Health);
  Pawn.SetHealth(Health);
  ApplyModel(Pawn, Model);
  Pawn.SetModelScale(SizeScale);
}
function RestoreDefaultBody(Pawn) {
  ApplyBody(Pawn, DefaultHealth, DefaultSizeScale, "");
}
function HideBody(Pawn) {
  const OwnModels = GOwnModels.get(GetPlayerSlot(Pawn));
  const Own = OwnModels ? OwnModels.get(Pawn.GetTeamNumber()) : void 0;
  if (Own !== void 0) {
    Pawn.SetModel(Own);
  }
  Pawn.SetColor({ ...Pawn.GetColor(), a: 0 });
}
function ShowBody(Pawn) {
  Pawn.SetColor({ ...Pawn.GetColor(), a: 255 });
}
function ForgetPlayerModel(Slot) {
  GOwnModels.delete(Slot);
}
function ApplyModel(Pawn, Model) {
  const OwnModels = GetOrCreate(GOwnModels, GetPlayerSlot(Pawn), () => {
    return /* @__PURE__ */ new Map();
  });
  const Team = Pawn.GetTeamNumber();
  const Current = Pawn.GetModelName();
  if (Current !== "" && !GClassModels.has(NormalizeModelName(Current))) {
    OwnModels.set(Team, Current);
  }
  const Wanted = Model !== "" ? Model : OwnModels.get(Team);
  if (Wanted !== void 0 && NormalizeModelName(Wanted) !== NormalizeModelName(Current)) {
    if (Model !== "") {
      GClassModels.add(NormalizeModelName(Model));
    }
    Pawn.SetModel(Wanted);
    if (NormalizeModelName(Pawn.GetModelName()) !== NormalizeModelName(Wanted) && !GWarnedModels.has(Wanted)) {
      GWarnedModels.add(Wanted);
      Console6.Log(`${LogPrefix} couldn't put on model "${Wanted}": is it in the map? Add a prop_dynamic using it somewhere out of sight so it's loaded.`);
    }
  }
  Pawn.SetColor(Model !== "" ? GetTeamColor(Pawn) : UntintedColor);
}
function NormalizeModelName(Name) {
  return Name.toLowerCase().replace(/\\/g, "/").replace(/_c$/, "");
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
    ApplyBody(Pawn, this.Settings.Health, this.Settings.SizeScale, this.Settings.Model);
    if (this.Settings.Melee !== "") {
      Pawn.GiveNamedItem(this.Settings.Melee);
      if (!Pawn.FindWeaponBySlot(CSGearSlot2.KNIFE)) {
        Pawn.GiveNamedItem(FallbackMelee);
      }
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
    const StartWeapon = this.Settings.bStartWithMelee ? Pawn.FindWeaponBySlot(CSGearSlot2.KNIFE) : this.Settings.bStartWithSecondary && bHasSecondary ? Pawn.FindWeapon(this.Settings.Secondary) : void 0;
    if (StartWeapon) {
      Pawn.SwitchToWeapon(StartWeapon);
    }
    this.OnLoadoutApplied(Pawn);
  }
  // Override for class-specific setup. Runs after the shared loadout.
  OnLoadoutApplied(Pawn) {
  }
  PlayPickFx(Pawn) {
    if (this.Settings.PickFxTemplate !== "") {
      SpawnTemporaryTemplate(this.Settings.PickFxTemplate, Pawn.GetEyePosition(), PickFxLifetime);
    }
  }
  // Called when someone playing this class fires their primary
  // ChargeFraction is 0 to 1 for launchers that charge, else 0
  OnPrimaryFire(Pawn, Slot, Now, ChargeFraction) {
  }
  // Called when someone playing this class fires their secondary
  OnSecondaryFire(Pawn, Slot, Now, ChargeFraction) {
  }
  // Called for a launcher's second fire mode (ATTACK2), when its settings give it one
  OnPrimaryAltFire(Pawn, Slot, Now) {
  }
  OnSecondaryAltFire(Pawn, Slot, Now) {
  }
  // Passes a launcher shot on to the matching On...Fire
  OnLauncherFired(Pawn, Slot, Now, Shot) {
    if (Shot.WeaponName === this.Settings.Primary) {
      if (Shot.bAltFire) {
        this.OnPrimaryAltFire(Pawn, Slot, Now);
      } else {
        this.OnPrimaryFire(Pawn, Slot, Now, Shot.ChargeFraction);
      }
    } else if (Shot.WeaponName === this.Settings.Secondary) {
      if (Shot.bAltFire) {
        this.OnSecondaryAltFire(Pawn, Slot, Now);
      } else {
        this.OnSecondaryFire(Pawn, Slot, Now, Shot.ChargeFraction);
      }
    }
  }
  // The weapons a bot of this class shoots with: by default every one the script fires
  // WHAT ^
  GetBotWeapons() {
    const Weapons = this.Settings.PrimaryLauncher ? [this.Settings.Primary] : [];
    if (this.Settings.SecondaryLauncher && this.Settings.Secondary !== "" && this.Settings.Secondary !== this.Settings.Primary) {
      Weapons.push(this.Settings.Secondary);
    }
    return Weapons;
  }
  // Override for weapons that fire projectiles, so bots lead and arc their shots. undefined = lands instantly.
  GetBallistics(WeaponName) {
    return void 0;
  }
  // Override so bots know what a weapon does. undefined = they fire it at anything they see.
  GetBotShot(WeaponName) {
    return void 0;
  }
  // Override for a class that builds: the weapon its bots hold to build with
  GetBotBuildTool(Pawn) {
    return void 0;
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
    if (this.Settings.MeleeDamage !== void 0 && IsKnife(Event.weapon)) {
      return this.Settings.MeleeDamage > 0 ? { damage: this.Settings.MeleeDamage } : { abort: true };
    }
    if (this.IsPrimaryBulletDamage(Event) || this.IsSecondaryBulletDamage(Event)) {
      return { abort: true };
    }
  }
  // Called for every damage event, whoever deals it (e.g. über protecting a patient)
  ModifyAnyDamage(Event) {
    return;
  }
  // Override for a class that heals: who it's healing right now, so their health stays on its HUD
  GetHealTarget(Slot) {
    return void 0;
  }
  // Override for a class that builds: what each mouse button builds right now, or undefined while its build tool isn't out
  GetBuildKeys(Pawn) {
    return void 0;
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
function FireHitscanWeapon(Shooter, Settings, Weapon, Intercept) {
  const Start = Shooter.GetEyePosition();
  const Aim = GetAimAngles(Shooter);
  FireHitscan(Shooter, Settings, Weapon, Start, Aim, VectorMath.Subtract(Start, BeamStartDrop), Intercept);
  const Backwards = VectorMath.Scale(VectorMath.GetForwardVector(Aim), -1);
  ApplyKnockback(Shooter, Backwards, Settings.Damage * Settings.Pellets, Settings.SelfKnockback, true);
}
function FireHitscan(Attacker, Settings, Weapon, Start, Aim, BeamStart, Intercept) {
  let DamageTotal = 0;
  for (let Pellet = 0; Pellet < Settings.Pellets; Pellet++) {
    const Direction = GetSpreadDirection(Aim, Settings.Spread);
    const Result = TraceHitscanWeapon(Attacker, Settings, Start, Direction);
    const End = (Intercept ? Intercept(Start, Result.End) : void 0) ?? Result.End;
    const MaxDistance = VectorMath.Size(VectorMath.Subtract(End, Start));
    for (const Hit of Result.Hits) {
      const Distance = GetHitDistance(Hit, Start);
      if (Distance > MaxDistance) {
        continue;
      }
      const RangeScale = EvaluateDamageCurve(Settings.Falloff, Distance);
      const bHeadshot = Hit.Trace.hitGroup === CSHitGroup.HEAD;
      const Damage = Settings.Damage * RangeScale * (bHeadshot ? Settings.HeadshotMultiplier : 1);
      ApplyKnockback(Hit.Victim, Direction, Damage, Settings.Knockback, false);
      const DamageDealt = DealShockDamage(Attacker, Hit.Victim, Damage, Weapon);
      DamageTotal += DamageDealt;
      if (DamageDealt > 0 && Settings.bBloodSplatter) {
        SpawnBloodSplatter(Start, Hit.Victim);
      }
    }
    const BuildingDistance = VectorMath.Size(VectorMath.Subtract(Result.End, Start));
    if (Result.HitBuilding && BuildingDistance <= MaxDistance) {
      DamageBuilding(Result.HitBuilding, Settings.Damage * EvaluateDamageCurve(Settings.Falloff, BuildingDistance), Attacker);
    }
    if (!Settings.bHeldBeam) {
      SpawnBeam(Settings.BeamTemplate, Settings.BeamEndName, BeamStart, End, Settings.BeamLifetime, GetTeamColor(Attacker));
    }
    if (Settings.ImpactTemplate !== "") {
      SpawnTemporaryTemplate(Settings.ImpactTemplate, End, Settings.ImpactLifetime);
    }
  }
  return DamageTotal;
}
function GetHitscanBotShot(Settings) {
  return { Damage: Settings.Damage * Settings.Pellets, Spread: Settings.Spread, Range: Settings.Range, Falloff: Settings.Falloff, BlastRadius: 0 };
}
function GetProjectileBotShot(Damage, BlastRadius, Falloff = []) {
  return { Damage, Spread: 0, Range: ProjectileBotRange, Falloff, BlastRadius };
}
function TraceHitscanWeapon(Shooter, Settings, Start, Direction) {
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
function PickRandomClass() {
  const Index = Math.floor(Math.random() * PlayableClasses.length);
  return PlayableClasses[Index] ?? "soldier" /* Solider */;
}
function GiveNoClassLoadout(Pawn) {
  StripGearSlots(Pawn, NoClassStrippedGearSlots);
  const Knife = Pawn.FindWeaponBySlot(CSGearSlot2.KNIFE);
  if (Knife) {
    Pawn.SwitchToWeapon(Knife);
  } else {
    Pawn.GiveNamedItem(NoClassMelee, true);
  }
}

// src/classes/bm_classlist.ts
import { CSGearSlot as CSGearSlot4, CSWeaponType as CSWeaponType3 } from "cs_script/point_script";

// src/classes/bm_soldier.ts
var SoldierSettings = {
  DisplayName: "Soldier",
  PickFxTemplate: "soldier_pick_template",
  Primary: "weapon_sg556",
  Secondary: "",
  Melee: "weapon_knife",
  Health: 150,
  SizeScale: 1.15,
  Model: "agents/models/otakku/wesker_playermodel/wesker_playermodel.vmdl",
  PrimaryLauncher: {
    FireInterval: 0.8,
    ClipSize: 4,
    ReloadFirstTime: 0.92,
    ReloadEachTime: 0.8,
    ChargeTime: 0,
    DeployTime: 0.1,
    FireFxTemplate: "rocket_fire_template",
    ReloadFxTemplate: "rocket_reload_template"
  },
  SecondaryLauncher: void 0,
  RocketDamage: 75,
  RocketRadius: 160,
  RocketSpeed: 1200,
  RocketKnockback: 400,
  RocketLifetime: 10,
  RocketFalloff: TF2RocketFalloff
};
var RocketTemplateName = "rocket_template";
var SoldierClass = class extends PlayerClass {
  Rockets = [];
  constructor() {
    super(SoldierSettings);
  }
  GetBallistics(WeaponName) {
    return { Speed: this.Settings.RocketSpeed, UpSpeed: 0, GravityScale: 0 };
  }
  GetBotShot(WeaponName) {
    return GetProjectileBotShot(this.Settings.RocketDamage, this.Settings.RocketRadius);
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
    DestroyProjectiles(this.Rockets);
    this.Rockets = [];
  }
  StepRocket(Rocket, Now, DeltaTime) {
    return StepImpactProjectile(Rocket, Now, DeltaTime, this.Settings.RocketLifetime, () => {
      Explode(Rocket.Position, Rocket.Owner, this.Settings.RocketRadius, this.Settings.RocketDamage, this.Settings.RocketKnockback, this.Settings.RocketFalloff);
    });
  }
};

// src/classes/bm_demoman.ts
import { Instance as Instance7, CSInputs as CSInputs2 } from "cs_script/point_script";
var TF2StickyFalloff = { RampUp: 1.1, FallOff: 0.9, OptimalDistance: 512 };
var DemoSettings = {
  DisplayName: "Exploder",
  PickFxTemplate: "demo_pick_template",
  Primary: "weapon_sawedoff",
  Secondary: "weapon_deagle",
  Melee: "",
  Health: 130,
  SizeScale: 1.2,
  Model: "agents/models/otakku/homer_simpson/homer_simpson.vmdl",
  PrimaryLauncher: {
    FireInterval: 0.6,
    ClipSize: 6,
    ReloadFirstTime: 1.09,
    ReloadEachTime: 0.67,
    ChargeTime: 4,
    bFireOnRelease: true,
    DeployTime: 0.1,
    FireFxTemplate: "sticky_fire_template",
    ReloadFxTemplate: "sticky_reload_template"
  },
  SecondaryLauncher: {
    FireInterval: 0.6,
    ClipSize: 4,
    ReloadFirstTime: 1.24,
    ReloadEachTime: 0.6,
    ChargeTime: 0,
    DeployTime: 0.1,
    FireFxTemplate: "pipe_fire_template",
    ReloadFxTemplate: "pipe_reload_template"
  },
  StickyDetonateKey: CSInputs2.ATTACK2,
  StickyMax: 6,
  StickyArmTime: 0.8,
  StickyLaunchSpeed: 900,
  StickyMaxLaunchSpeed: 2400,
  StickyLaunchUp: 150,
  StickyRadius: 160,
  StickyDamage: 90,
  StickyKnockback: 450,
  StickyFalloff: TF2StickyFalloff,
  StickyFalloffTime: 5,
  StickyShootRadius: 12,
  StickyWeight: 1,
  PipeLaunchSpeed: 1337,
  PipeLaunchUp: 150,
  PipeRadius: 160,
  PipeDamage: 75,
  PipeRolledDamageScale: 0.6,
  PipeKnockback: 500,
  PipeFalloff: TF2PipeFalloff,
  PipeFuseTime: 1.6,
  PipeBounce: {
    Restitution: 0.2,
    ImpactFriction: 0.5,
    RollFriction: 1200,
    SettleSpeed: 100
  }
};
var StickyTemplateName = "sticky_template";
var PipeTemplateName = "pipe_template";
var UnarmedStickyColor = { r: 240, g: 240, b: 240 };
var DemomanClass = class extends PlayerClass {
  PlayerStates = /* @__PURE__ */ new Map();
  Pipes = [];
  constructor() {
    super(DemoSettings);
  }
  // pipes only 4 those fuckers
  GetBotWeapons() {
    return [this.Settings.Secondary];
  }
  GetBallistics(WeaponName) {
    return WeaponName === this.Settings.Primary ? { Speed: this.Settings.StickyLaunchSpeed, UpSpeed: this.Settings.StickyLaunchUp, GravityScale: 1 } : { Speed: this.Settings.PipeLaunchSpeed, UpSpeed: this.Settings.PipeLaunchUp, GravityScale: 1 };
  }
  GetBotShot(WeaponName) {
    return WeaponName === this.Settings.Primary ? GetProjectileBotShot(this.Settings.StickyDamage, this.Settings.StickyRadius) : GetProjectileBotShot(this.Settings.PipeDamage, this.Settings.PipeRadius);
  }
  OnPrimaryFire(Pawn, Slot, Now, ChargeFraction) {
    const Speed = this.Settings.StickyLaunchSpeed + (this.Settings.StickyMaxLaunchSpeed - this.Settings.StickyLaunchSpeed) * ChargeFraction;
    const Sticky = {
      ...LaunchProjectile(Pawn, Speed, this.Settings.StickyLaunchUp, 1, StickyTemplateName),
      bStuck: false,
      ArmedAt: Now + this.Settings.StickyArmTime,
      bTintedArmed: false
    };
    TintProjectile(Sticky, UnarmedStickyColor);
    MakeShootable(Sticky, this.Settings.StickyShootRadius, this.Settings.StickyWeight, (Push) => {
      Sticky.Velocity = Sticky.bStuck ? Push : VectorMath.Add(Sticky.Velocity, Push);
      Sticky.bStuck = false;
    });
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
    State.Stickies = State.Stickies.filter((Sticky) => {
      return !Sticky.bDestroyed;
    });
    for (const Sticky of State.Stickies) {
      if (!Sticky.bStuck && MoveProjectile(Sticky, DeltaTime, false)) {
        Sticky.bStuck = true;
      }
    }
    for (const Sticky of State.Stickies) {
      const bArmed = Now >= Sticky.ArmedAt;
      if (Sticky.Models.length === 0) {
        Instance7.DebugSphere({ center: Sticky.Position, radius: 4, duration: TickInterval * 2, color: bArmed ? GetTeamColor(Pawn) : UnarmedStickyColor });
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
    DestroyProjectiles(this.Pipes);
    this.Pipes = [];
  }
  ClearPlayer(Slot) {
    const State = this.PlayerStates.get(Slot);
    if (!State) {
      return;
    }
    DestroyProjectiles(State.Stickies);
    this.PlayerStates.delete(Slot);
  }
  GetHudCounter(Slot) {
    const State = this.PlayerStates.get(Slot);
    return { Label: "Stickies", Count: State ? State.Stickies.length : 0, Max: bDebug ? 0 : this.Settings.StickyMax };
  }
  GetPlayerState(Slot) {
    return GetOrCreate(this.PlayerStates, Slot, () => {
      return { Stickies: [], bDetonateHeld: false };
    });
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
    DrawMissingProjectile(Pipe);
    return true;
  }
  DetonatePipe(Pipe) {
    DestroyProjectile(Pipe);
    const Damage = this.Settings.PipeDamage * (Pipe.bTouchedWorld ? this.Settings.PipeRolledDamageScale : 1);
    Explode(Pipe.Position, Pipe.Owner, this.Settings.PipeRadius, Damage, this.Settings.PipeKnockback, this.Settings.PipeFalloff);
  }
};

// src/classes/bm_medic.ts
import { Instance as Instance8, Console as Console7, CSInputs as CSInputs3 } from "cs_script/point_script";
var CrossbowRampUp = [
  { Distance: 0, Scale: 0.5 },
  { Distance: 256, Scale: 0.5 },
  { Distance: 2048, Scale: 1 }
];
var MedicSettings = {
  DisplayName: "Medic",
  PickFxTemplate: "medic_pick_template",
  Primary: "weapon_nova",
  Secondary: "",
  Melee: "weapon_knife",
  Health: 150,
  SizeScale: 0.9,
  Model: "agents/models/otakku/burnice/burnice.vmdl",
  bStartWithMelee: true,
  MeleeDamage: 20,
  PrimaryLauncher: {
    FireInterval: 0.2,
    ClipSize: 1,
    ReloadFirstTime: 1.6,
    ReloadEachTime: 0,
    ChargeTime: 0,
    DeployTime: 0.1,
    FireFxTemplate: "crossbow_fire_template",
    ReloadFxTemplate: "crossbow_reload_template"
  },
  SecondaryLauncher: void 0,
  BoltSpeed: 2400,
  BoltGravityScale: 0.2,
  BoltDamage: 75,
  BoltHeal: 150,
  BoltRampUp: CrossbowRampUp,
  BoltLifetime: 5,
  BoltStickTime: 3,
  Range: 450,
  BreakRange: 540,
  HealPerSec: 24,
  OverhealMult: 1.5,
  OverhealDecayPerSec: 3.3,
  UberSecondsToFill: 40,
  UberDuration: 8,
  HealSound: "bm.medic.heal_loop"
};
var BoltTemplateName = "crossbow_bolt_template";
var MedicClass = class extends PlayerClass {
  PlayerStates = /* @__PURE__ */ new Map();
  DecayAccumulators = /* @__PURE__ */ new Map();
  // overheal decay, for any player
  HealedThisTick = /* @__PURE__ */ new Set();
  UberedThisTick = /* @__PURE__ */ new Set();
  UberedPawns = /* @__PURE__ */ new Set();
  GlowingPawns = /* @__PURE__ */ new Set();
  Bolts = [];
  constructor() {
    super(MedicSettings);
  }
  GetBallistics(WeaponName) {
    return { Speed: this.Settings.BoltSpeed, UpSpeed: 0, GravityScale: this.Settings.BoltGravityScale };
  }
  GetBotShot(WeaponName) {
    return GetProjectileBotShot(this.Settings.BoltDamage, 0, this.Settings.BoltRampUp);
  }
  OnPrimaryFire(Pawn, Slot, Now) {
    const Projectile = LaunchProjectile(Pawn, this.Settings.BoltSpeed, 0, this.Settings.BoltGravityScale, BoltTemplateName);
    this.Bolts.push({ ...Projectile, StuckUntil: void 0 });
  }
  TickWorld(Now, DeltaTime) {
    this.HealedThisTick = /* @__PURE__ */ new Set();
    this.UberedThisTick = /* @__PURE__ */ new Set();
    this.Bolts = this.Bolts.filter((Bolt) => {
      return this.StepBolt(Bolt, Now, DeltaTime);
    });
  }
  TickPlayer(Pawn, Slot, Now, DeltaTime) {
    const State = this.GetPlayerState(Slot);
    const bHoldingMedigun = IsKnife(Pawn.GetActiveWeapon());
    const bFiring = bHoldingMedigun && Pawn.IsInputPressed(CSInputs3.ATTACK);
    let Target = bFiring ? State.HealTarget : void 0;
    if (Target && !this.IsHealTargetValid(Pawn, Target)) {
      Target = void 0;
    }
    if (bFiring && !Target) {
      Target = this.AcquireHealTarget(Pawn);
    }
    State.HealTarget = Target;
    this.UpdateHealSound(Pawn, State, Target !== void 0);
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
      Instance8.DebugLine(
        {
          start: VectorMath.Subtract(Pawn.GetEyePosition(), BeamStartDrop),
          end: GetChestPosition(Target),
          duration: TickInterval * 2,
          color: GetTeamColor(Pawn)
        }
      );
    }
    if (Now >= State.UberEndTime && State.UberCharge >= 100 && bHoldingMedigun && Pawn.IsInputPressed(CSInputs3.ATTACK2)) {
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
  }
  TickWorldLate(Now, DeltaTime) {
    this.TickOverhealDecay(DeltaTime);
    this.UpdateUberGlows();
    this.UberedPawns = this.UberedThisTick;
  }
  OnRoundStart() {
    for (const State of this.PlayerStates.values()) {
      this.StopHealSound(State);
    }
    this.PlayerStates.clear();
    DestroyProjectiles(this.Bolts);
    this.Bolts = [];
  }
  ClearPlayer(Slot) {
    const State = this.PlayerStates.get(Slot);
    if (State) {
      this.StopHealSound(State);
    }
    this.PlayerStates.delete(Slot);
    this.DecayAccumulators.delete(Slot);
  }
  GetHealTarget(Slot) {
    const Target = this.PlayerStates.get(Slot)?.HealTarget;
    return Target && Target.IsValid() && Target.IsAlive() ? Target : void 0;
  }
  GetHudCounter(Slot) {
    const State = this.PlayerStates.get(Slot);
    return { Label: "\xDCber", Count: State ? Math.floor(State.UberCharge) : 0, Max: 100 };
  }
  ModifyAnyDamage(Event) {
    if (this.UberedPawns.has(Event.player)) {
      return { abort: true };
    }
    return;
  }
  StepBolt(Bolt, Now, DeltaTime) {
    if (Bolt.StuckUntil !== void 0 || IsProjectileExpired(Bolt, Now, this.Settings.BoltLifetime)) {
      if (Bolt.StuckUntil !== void 0 && Now < Bolt.StuckUntil) {
        return true;
      }
      DestroyProjectile(Bolt);
      return false;
    }
    const Hit = MoveProjectile(Bolt, DeltaTime, true);
    if (Hit && IsPlayerPawn(Hit.hitEntity)) {
      DestroyProjectile(Bolt);
      this.BoltHitPlayer(Bolt, Hit.hitEntity);
      return false;
    }
    if (Hit && DamageTracedBuilding(Hit, this.Settings.BoltDamage * this.GetBoltRangeScale(Bolt), Bolt.Owner)) {
      DestroyProjectile(Bolt);
      return false;
    }
    if (Hit) {
      Bolt.StuckUntil = Now + this.Settings.BoltStickTime;
      return Bolt.Models.length > 0;
    }
    DrawMissingProjectile(Bolt);
    return true;
  }
  GetBoltRangeScale(Bolt) {
    return EvaluateDamageCurve(this.Settings.BoltRampUp, VectorMath.Size(VectorMath.Subtract(Bolt.Position, Bolt.Start)));
  }
  BoltHitPlayer(Bolt, Victim) {
    const Medic = Bolt.Owner;
    const Distance = VectorMath.Size(VectorMath.Subtract(Bolt.Position, Bolt.Start));
    const RangeScale = this.GetBoltRangeScale(Bolt);
    const MedicName = GetPawnName(Medic);
    const VictimName = GetPawnName(Victim);
    if (IsTeammate(Victim, Medic)) {
      const Health = Victim.GetHealth();
      const Healed = Math.min(Victim.GetMaxHealth(), Health + Math.round(this.Settings.BoltHeal * RangeScale));
      if (Healed > Health) {
        Victim.SetHealth(Healed);
      }
      Console7.Log(`${LogPrefix} ${MedicName} Healed (bolt) ${VictimName} : +${Math.max(0, Healed - Health)}h : ${Math.round(Distance)}u x${RangeScale.toFixed(2)}`);
      return;
    }
    const Damage = this.Settings.BoltDamage * RangeScale;
    DealShockDamage(Medic, Victim, Damage, Medic.FindWeapon(this.Settings.Primary));
    Console7.Log(`${LogPrefix} ${MedicName} Damaged (bolt) ${VictimName} : ${Math.round(Damage)}d : ${Math.round(Distance)}u x${RangeScale.toFixed(2)}`);
  }
  UpdateHealSound(Pawn, State, bHealing) {
    if (bHealing && !State.HealSound) {
      State.HealSound = StartSoundOn(this.Settings.HealSound, Pawn);
    } else if (!bHealing) {
      this.StopHealSound(State);
    }
  }
  StopHealSound(State) {
    if (State.HealSound) {
      StopSound(State.HealSound);
      State.HealSound = void 0;
    }
  }
  GetPlayerState(Slot) {
    return GetOrCreate(this.PlayerStates, Slot, () => {
      return { HealTarget: void 0, HealAccumulator: 0, UberCharge: 0, UberEndTime: 0, HealSound: void 0 };
    });
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
    return !Instance8.TraceLine({ start: EyePosition, end: TargetChest, ignorePlayers: true }).didHit;
  }
  AcquireHealTarget(Medic) {
    const EyePosition = Medic.GetEyePosition();
    const Forward = VectorMath.GetForwardVector(Medic.GetEyeAngles());
    const End = VectorMath.Add(EyePosition, VectorMath.Scale(Forward, this.Settings.Range));
    const HitEntity = Instance8.TraceSphere({ start: EyePosition, end: End, radius: 12, ignoreEntity: Medic }).hitEntity;
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

// src/classes/bm_railer.ts
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
var RailerSettings = {
  DisplayName: "Railer",
  PickFxTemplate: "railer_pick_template",
  Primary: "weapon_famas",
  Secondary: "weapon_revolver",
  Melee: "",
  bStartWithSecondary: true,
  Health: 110,
  SizeScale: 0.85,
  Model: "agents/models/otakku/kakashi_hatake/kakashi_hatake.vmdl",
  PrimaryLauncher: {
    FireInterval: 0.06,
    ClipSize: 20,
    ReloadFirstTime: 1.6,
    ReloadEachTime: 0,
    ChargeTime: 0,
    DeployTime: 0.1,
    FireFxTemplate: "rail_shot_fire_template",
    ReloadFxTemplate: "rail_shot_reload_template"
  },
  SecondaryLauncher: {
    FireInterval: 0.5,
    ClipSize: 1,
    ReloadFirstTime: 3,
    ReloadEachTime: 3,
    ChargeTime: 1,
    DeployTime: 0.1,
    FireFxTemplate: "rail_fire_template",
    ReloadFxTemplate: "rail_reload_template"
  },
  PPsh: {
    Damage: 8,
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
  },
  ChargeBeamTemplate: "rail_charge_beam_template",
  ChargeBeamEndName: "rail_charge_beam_end",
  ChargeBeamRefireStart: 0.25,
  ChargeBeamRefireFull: 0.04
};
var RailerClass = class extends PlayerClass {
  ChargeBeams = /* @__PURE__ */ new Map();
  constructor() {
    super(RailerSettings);
  }
  GetBotShot(WeaponName) {
    return GetHitscanBotShot(WeaponName === this.Settings.Primary ? this.Settings.PPsh : this.Settings.Railgun);
  }
  OnPrimaryFire(Pawn, Slot, Now) {
    FireHitscanWeapon(Pawn, this.Settings.PPsh, Pawn.FindWeapon(this.Settings.Primary));
  }
  OnSecondaryFire(Pawn, Slot, Now) {
    FireHitscanWeapon(Pawn, this.Settings.Railgun, Pawn.FindWeapon(this.Settings.Secondary));
  }
  TickPlayer(Pawn, Slot, Now, DeltaTime) {
    const Ammo = GetLauncherAmmo(Pawn, Slot);
    const bCharging = Ammo !== void 0 && Ammo.ChargeFraction > 0 && IsWeapon(GetHeldWeapon(Pawn), this.Settings.Secondary);
    if (!Ammo || !bCharging) {
      this.StopChargeBeam(Slot);
      return;
    }
    const Start = Pawn.GetEyePosition();
    const End = TraceHitscanWeapon(Pawn, this.Settings.Railgun, Start, VectorMath.GetForwardVector(GetAimAngles(Pawn))).End;
    const BeamStart = VectorMath.Subtract(Start, BeamStartDrop);
    const RefireInterval = this.Settings.ChargeBeamRefireStart + (this.Settings.ChargeBeamRefireFull - this.Settings.ChargeBeamRefireStart) * Ammo.ChargeFraction;
    const Beam = this.ChargeBeams.get(Slot);
    if (Beam) {
      Beam.RefireInterval = RefireInterval;
      MoveHeldBeam(Beam, BeamStart, End);
    } else {
      this.ChargeBeams.set(Slot, SpawnHeldBeam(this.Settings.ChargeBeamTemplate, this.Settings.ChargeBeamEndName, BeamStart, End, GetTeamColor(Pawn), RefireInterval));
    }
  }
  OnRoundStart() {
    for (const Slot of [...this.ChargeBeams.keys()]) {
      this.StopChargeBeam(Slot);
    }
  }
  ClearPlayer(Slot) {
    this.StopChargeBeam(Slot);
  }
  StopChargeBeam(Slot) {
    const Beam = this.ChargeBeams.get(Slot);
    if (Beam) {
      RemoveHeldBeam(Beam);
      this.ChargeBeams.delete(Slot);
    }
  }
};

// src/classes/bm_beamer.ts
import { CSInputs as CSInputs4 } from "cs_script/point_script";
var BeamerBeamFalloff = [
  { Distance: 0, Scale: 1 },
  { Distance: 512, Scale: 0.5 },
  { Distance: 1200, Scale: 0.2 }
];
var BeamerSettings = {
  DisplayName: "Beamer",
  PickFxTemplate: "beamer_pick_template",
  Primary: "weapon_negev",
  Secondary: "weapon_elite",
  Melee: "",
  Health: 200,
  SizeScale: 1.3,
  Model: "agents/models/otakku/coach/coach.vmdl",
  PrimaryLauncher: {
    FireInterval: 0.05,
    ClipSize: 111,
    ReloadFirstTime: 2.5,
    ReloadEachTime: 0,
    ChargeTime: 0,
    DeployTime: 0.1,
    FireFxTemplate: "",
    ReloadFxTemplate: "beamer_beam_reload_template"
  },
  SecondaryLauncher: {
    FireInterval: 0.3,
    ClipSize: 2,
    ReloadFirstTime: 1.4,
    ReloadEachTime: 0,
    ChargeTime: 0,
    DeployTime: 0.1,
    FireFxTemplate: "beamer_shot_fire_template",
    ReloadFxTemplate: "beamer_shot_reload_template"
  },
  EnergyBeam: {
    Damage: 7,
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
  EnergyBeamRefireInterval: 0.05,
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
var BeamerClass = class extends PlayerClass {
  PlayerStates = /* @__PURE__ */ new Map();
  constructor() {
    super(BeamerSettings);
  }
  GetBotShot(WeaponName) {
    return GetHitscanBotShot(WeaponName === this.Settings.Primary ? this.Settings.EnergyBeam : this.Settings.Shotgun);
  }
  OnPrimaryFire(Pawn, Slot, Now) {
    FireHitscanWeapon(Pawn, this.Settings.EnergyBeam, Pawn.FindWeapon(this.Settings.Primary));
    this.GetPlayerState(Slot).LastBeamTime = Now;
  }
  OnSecondaryFire(Pawn, Slot, Now) {
    FireHitscanWeapon(Pawn, this.Settings.Shotgun, Pawn.FindWeapon(this.Settings.Secondary));
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
    const End = TraceHitscanWeapon(Pawn, Beam, Start, VectorMath.GetForwardVector(GetAimAngles(Pawn))).End;
    const BeamStart = VectorMath.Subtract(Start, BeamStartDrop);
    if (State.Beam) {
      MoveHeldBeam(State.Beam, BeamStart, End);
    } else {
      State.Beam = SpawnHeldBeam(Beam.BeamTemplate, Beam.BeamEndName, BeamStart, End, GetTeamColor(Pawn), this.Settings.EnergyBeamRefireInterval);
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
    return GetOrCreate(this.PlayerStates, Slot, () => {
      return { Beam: void 0, LastBeamTime: 0 };
    });
  }
  IsBeamOn(Pawn, State, Now) {
    const FireInterval = this.Settings.PrimaryLauncher ? this.Settings.PrimaryLauncher.FireInterval : 0;
    const bStillFiring = Now - State.LastBeamTime <= FireInterval + TickInterval * 1.5;
    return bStillFiring && IsInputDown(Pawn, CSInputs4.ATTACK) && IsWeapon(GetHeldWeapon(Pawn), this.Settings.Primary);
  }
  StopBeam(State) {
    if (State.Beam) {
      RemoveHeldBeam(State.Beam);
      State.Beam = void 0;
    }
  }
};

// src/classes/bm_boxer.ts
import { Console as Console8 } from "cs_script/point_script";
var BoxerCubeFalloff = [
  { Distance: 0, Scale: 1 },
  { Distance: 512, Scale: 0.75 },
  { Distance: 2048, Scale: 0.5 }
];
var BoxerSettings = {
  DisplayName: "Cuber",
  PickFxTemplate: "boxer_pick_template",
  Primary: "weapon_m249",
  Secondary: "weapon_deagle",
  Melee: "",
  Health: 180,
  SizeScale: 1.25,
  Model: "agents/models/otakku/rochelle/rochelle.vmdl",
  PrimaryLauncher: {
    FireInterval: 0.8,
    ClipSize: 1,
    ReloadFirstTime: 1,
    ReloadEachTime: 0.8,
    ChargeTime: 0,
    DeployTime: 0.1,
    FireFxTemplate: "cube_fire_template",
    ReloadFxTemplate: "cube_reload_template"
  },
  SecondaryLauncher: {
    FireInterval: 0.625,
    ClipSize: 4,
    ReloadFirstTime: 0.7,
    ReloadEachTime: 0.5,
    ChargeTime: 0,
    DeployTime: 0.1,
    FireFxTemplate: "boxer_shot_fire_template",
    ReloadFxTemplate: "boxer_shot_reload_template"
  },
  CubeSpeed: 800,
  CubeGravityScale: 0,
  CubeRadius: 12,
  CubeDamage: 150,
  CubeFalloff: BoxerCubeFalloff,
  CubeKnockback: 300,
  CubeLifetime: 5,
  Shotgun: {
    Damage: 10,
    HeadshotMultiplier: 1,
    Range: 2048,
    Spread: 6,
    Pellets: 8,
    bPierces: false,
    Falloff: BeamerShotgunFalloff,
    Knockback: 300,
    SelfKnockback: 150,
    bBloodSplatter: false,
    bHeldBeam: false,
    BeamTemplate: "boxer_shot_tracer_template",
    BeamEndName: "boxer_shot_tracer_end",
    BeamLifetime: 0.06,
    ImpactTemplate: "",
    ImpactLifetime: 0
  }
};
var CubeTemplateName = "cube_template";
var BoxerClass = class extends PlayerClass {
  Cubes = [];
  constructor() {
    super(BoxerSettings);
  }
  GetBallistics(WeaponName) {
    return WeaponName === this.Settings.Primary ? { Speed: this.Settings.CubeSpeed, UpSpeed: 0, GravityScale: this.Settings.CubeGravityScale } : void 0;
  }
  GetBotShot(WeaponName) {
    return WeaponName === this.Settings.Primary ? GetProjectileBotShot(this.Settings.CubeDamage, this.Settings.CubeRadius, this.Settings.CubeFalloff) : GetHitscanBotShot(this.Settings.Shotgun);
  }
  OnPrimaryFire(Pawn, Slot, Now) {
    const Projectile = LaunchProjectile(Pawn, this.Settings.CubeSpeed, 0, this.Settings.CubeGravityScale, CubeTemplateName, this.Settings.CubeRadius, "box" /* Box */);
    this.Cubes.push({ ...Projectile, HitPlayers: /* @__PURE__ */ new Set() });
  }
  OnSecondaryFire(Pawn, Slot, Now) {
    FireHitscanWeapon(Pawn, this.Settings.Shotgun, Pawn.FindWeapon(this.Settings.Secondary));
  }
  TickWorld(Now, DeltaTime) {
    this.Cubes = this.Cubes.filter((Cube) => {
      return this.StepCube(Cube, Now, DeltaTime);
    });
  }
  OnRoundStart() {
    DestroyProjectiles(this.Cubes);
    this.Cubes = [];
  }
  StepCube(Cube, Now, DeltaTime) {
    if (IsProjectileExpired(Cube, Now, this.Settings.CubeLifetime)) {
      DestroyProjectile(Cube);
      return false;
    }
    const Step = MovePiercingProjectile(Cube, DeltaTime);
    for (const Hit of Step.NewHits) {
      this.CubeHitPlayer(Cube, Hit);
    }
    if (Step.WorldHit) {
      const Distance = VectorMath.Size(VectorMath.Subtract(Cube.Position, Cube.Start));
      DamageTracedBuilding(Step.WorldHit, this.Settings.CubeDamage * EvaluateDamageCurve(this.Settings.CubeFalloff, Distance), Cube.Owner);
      DestroyProjectile(Cube);
      return false;
    }
    DrawMissingProjectile(Cube);
    return true;
  }
  CubeHitPlayer(Cube, Hit) {
    const Boxer = Cube.Owner;
    const Victim = Hit.Victim;
    if (IsTeammate(Victim, Boxer)) {
      return;
    }
    const Distance = VectorMath.Size(VectorMath.Subtract(Hit.Trace.end, Cube.Start));
    const RangeScale = EvaluateDamageCurve(this.Settings.CubeFalloff, Distance);
    const Damage = this.Settings.CubeDamage * RangeScale;
    ApplyKnockback(Victim, Cube.Velocity, Damage, this.Settings.CubeKnockback, false);
    if (DealShockDamage(Boxer, Victim, Damage, Boxer.FindWeapon(this.Settings.Primary)) > 0) {
      SpawnBloodSplatter(Hit.Trace.end, Victim);
    }
    Console8.Log(`${LogPrefix} ${GetPawnName(Boxer)} Damaged (cube) ${GetPawnName(Victim)} : ${Math.round(Damage)}d : ${Math.round(Distance)}u x${RangeScale.toFixed(2)}`);
  }
};

// src/classes/bm_shocker.ts
import { Instance as Instance9, Console as Console9 } from "cs_script/point_script";
var ShockerSettings = {
  DisplayName: "Shocker",
  PickFxTemplate: "shocker_pick_template",
  Primary: "weapon_m4a1",
  Secondary: "weapon_p250",
  Melee: "weapon_knife",
  Health: 125,
  SizeScale: 1.1,
  Model: "agents/models/otakku/agent_smith/agent_smith.vmdl",
  PrimaryLauncher: {
    FireInterval: 0.5,
    ClipSize: 3,
    ReloadFirstTime: 1,
    ReloadEachTime: 0.4,
    ChargeTime: 0,
    DeployTime: 0.1,
    FireFxTemplate: "shock_ball_fire_template",
    ReloadFxTemplate: "shock_reload_template"
  },
  SecondaryLauncher: {
    FireInterval: 0.4,
    ClipSize: 5,
    ReloadFirstTime: 1.6,
    ReloadEachTime: 0,
    ChargeTime: 0,
    DeployTime: 0.1,
    FireFxTemplate: "shock_beam_fire_template",
    ReloadFxTemplate: "shock_reload_template"
  },
  ShockBeam: {
    Damage: 33,
    HeadshotMultiplier: 1,
    Range: 8192,
    Spread: 0,
    Pellets: 1,
    bPierces: false,
    Falloff: [],
    Knockback: 250,
    SelfKnockback: 0,
    bBloodSplatter: false,
    bHeldBeam: false,
    BeamTemplate: "shock_beam_template",
    BeamEndName: "shock_beam_end",
    BeamLifetime: 0.3,
    ImpactTemplate: "shock_impact_template",
    ImpactLifetime: 1
  },
  BallSpeed: 1e3,
  BallSize: 16,
  BallDamage: 50,
  BallRadius: 80,
  BallKnockback: 500,
  BallLifetime: 5,
  BallStuckLifetime: 6,
  BallStickDepth: 0,
  BallStuckHitRadius: 16,
  BallWeight: 0.5,
  BallKnockedGravityScale: 1,
  BallFxTemplate: "shock_ball_explode_template",
  ComboDamage: 125,
  ComboRadius: 240,
  ComboKnockback: 300,
  ComboFxTemplate: "shock_combo_template"
};
var ShockBallTemplateName = "shock_ball_template";
var ShockerClass = class extends PlayerClass {
  Balls = [];
  constructor() {
    super(ShockerSettings);
  }
  GetBallistics(WeaponName) {
    return WeaponName === this.Settings.Primary ? { Speed: this.Settings.BallSpeed, UpSpeed: 0, GravityScale: 0 } : void 0;
  }
  GetBotShot(WeaponName) {
    return WeaponName === this.Settings.Primary ? GetProjectileBotShot(this.Settings.BallDamage, this.Settings.BallRadius) : GetHitscanBotShot(this.Settings.ShockBeam);
  }
  OnPrimaryFire(Pawn, Slot, Now) {
    const Ball = { ...LaunchProjectile(Pawn, this.Settings.BallSpeed, 0, 0, ShockBallTemplateName, this.Settings.BallSize), StuckAt: void 0 };
    this.Balls.push(Ball);
    MakeShootable(Ball, this.Settings.BallStuckHitRadius, this.Settings.BallWeight, (Push) => {
      this.KnockBall(Ball, Push);
    });
  }
  OnSecondaryFire(Pawn, Slot, Now) {
    FireHitscanWeapon(Pawn, this.Settings.ShockBeam, Pawn.FindWeapon(this.Settings.Secondary), (Start, End) => {
      return this.DetonateBallOnBeam(Pawn, Start, End);
    });
  }
  TickWorld(Now, DeltaTime) {
    this.Balls = this.Balls.filter((Ball) => {
      return this.StepBall(Ball, Now, DeltaTime);
    });
  }
  OnRoundStart() {
    DestroyProjectiles(this.Balls);
    this.Balls = [];
  }
  StepBall(Ball, Now, DeltaTime) {
    if (Ball.bDestroyed) {
      return false;
    }
    if (Ball.StuckAt !== void 0) {
      if (!Ball.Owner.IsValid() || Now - Ball.StuckAt >= this.Settings.BallStuckLifetime) {
        this.ExplodeBall(Ball);
        return false;
      }
      if (Ball.Models.length === 0) {
        DrawMissingProjectile(Ball);
      }
      return true;
    }
    if (IsProjectileExpired(Ball, Now, this.Settings.BallLifetime)) {
      DestroyProjectile(Ball);
      return false;
    }
    const Hit = MoveProjectile(Ball, DeltaTime, true);
    if (!Hit) {
      DrawMissingProjectile(Ball);
      return true;
    }
    if (!GetTraceBuilding(Hit) && (Hit.hitEntity === void 0 || Hit.hitEntity.IsWorld())) {
      EmbedProjectile(Ball, Hit, this.Settings.BallStickDepth);
      Ball.StuckAt = Now;
      return true;
    }
    this.ExplodeBall(Ball);
    return false;
  }
  KnockBall(Ball, Push) {
    if (Ball.StuckAt !== void 0) {
      Ball.StuckAt = void 0;
      Ball.SpawnedAt = Instance9.GetGameTime();
    }
    Ball.Velocity = VectorMath.Add(Ball.Velocity, Push);
    Ball.GravityScale = this.Settings.BallKnockedGravityScale;
  }
  ExplodeBall(Ball) {
    DestroyProjectile(Ball);
    Explode(Ball.Position, Ball.Owner, this.Settings.BallRadius, this.Settings.BallDamage, this.Settings.BallKnockback, void 0, this.Settings.BallFxTemplate);
  }
  DetonateBallOnBeam(Shooter, Start, End) {
    let Combo = void 0;
    let ComboDistance = Infinity;
    for (const Ball of this.Balls) {
      const Closest = VectorMath.ClosestPointOnSegment(Ball.Position, Start, End);
      const Distance = VectorMath.Size(VectorMath.Subtract(Closest, Start));
      const HitRadius = Ball.StuckAt !== void 0 ? this.Settings.BallStuckHitRadius : Ball.Radius;
      if (Ball.Owner === Shooter && VectorMath.Size(VectorMath.Subtract(Ball.Position, Closest)) <= HitRadius && Distance < ComboDistance) {
        Combo = Ball;
        ComboDistance = Distance;
      }
    }
    if (!Combo) {
      return void 0;
    }
    const Detonated = Combo;
    this.Balls = this.Balls.filter((Ball) => {
      return Ball !== Detonated;
    });
    DestroyProjectile(Detonated);
    Explode(Detonated.Position, Shooter, this.Settings.ComboRadius, this.Settings.ComboDamage, this.Settings.ComboKnockback, void 0, this.Settings.ComboFxTemplate);
    Console9.Log(`${LogPrefix} ${GetPawnName(Shooter)} shock combo, ${Math.round(VectorMath.Size(VectorMath.Subtract(Detonated.Position, Detonated.Start)))}u from where the ball was fired`);
    return Detonated.Position;
  }
};

// src/classes/bm_shrinker.ts
import { Instance as Instance10, Console as Console10, CSInputs as CSInputs5, CSDamageTypes as CSDamageTypes3, CSDamageFlags as CSDamageFlags2 } from "cs_script/point_script";
var ShrinkerSettings = {
  DisplayName: "Shrinker",
  PickFxTemplate: "shrinker_pick_template",
  Primary: "weapon_glock",
  Secondary: "",
  Melee: "weapon_knife",
  Health: 100,
  SizeScale: 1,
  Model: "agents/models/otakku/perry_the_platypus/perry_the_platypus.vmdl",
  bStartWithMelee: true,
  RepairPerHit: 25,
  PrimaryLauncher: void 0,
  SecondaryLauncher: void 0,
  ShrunkScale: 0.33,
  ShrinkTime: 1,
  GrowTime: 1,
  ShrunkDuration: 12,
  RechargeTime: 16,
  MinShrinkCharge: 10,
  ShrinkSound: "bm.shrinker.shrink",
  GrowSound: "bm.shrinker.grow",
  Trap: {
    DisplayName: "Trap",
    ModelTemplate: "shrinker_trap_template",
    DestroyFxTemplate: "shrinker_building_destroy_template",
    Health: 25,
    HalfWidth: 16,
    Height: 8,
    ThrowSpeed: 500,
    MaxCount: 2,
    RebuildDelay: 10,
    ArmTime: 1.5,
    TriggerReach: 28,
    TriggerHeight: 24,
    Damage: 150,
    BlastRadius: 120,
    BlastHeight: 24,
    Knockback: 300,
    ExplodeFxTemplate: "shrinker_trap_explode_template",
    OwnerDamage: 33,
    OwnerLaunchSpeed: 600,
    OwnerLaunchUpSpeed: 550
  },
  TeleporterEntrance: {
    DisplayName: "Teleporter Entrance",
    ModelTemplate: "shrinker_teleporter_entrance_template",
    DestroyFxTemplate: "shrinker_building_destroy_template",
    Health: 60,
    HalfWidth: 24,
    Height: 12,
    ThrowSpeed: 450,
    MaxCount: 1,
    RebuildDelay: 10,
    RechargeTime: 5,
    RechargeColor: { r: 110, g: 110, b: 110 },
    StandHeight: 40,
    TeleportFxTemplate: "shrinker_teleport_template"
  },
  TeleporterExit: {
    DisplayName: "Teleporter Exit",
    ModelTemplate: "shrinker_teleporter_exit_template",
    DestroyFxTemplate: "shrinker_building_destroy_template",
    Health: 60,
    HalfWidth: 24,
    Height: 12,
    ThrowSpeed: 450,
    MaxCount: 1,
    RebuildDelay: 10,
    RechargeTime: 5,
    RechargeColor: { r: 110, g: 110, b: 110 },
    StandHeight: 40,
    TeleportFxTemplate: "shrinker_teleport_template"
  }
};
var MaxShrinkCharge = 100;
var UnarmedTrapColor = { r: 255, g: 255, b: 255 };
var TeleportFxLifetime = 3;
var ArrivalLift = 2;
var TrapKind = class extends BuildingKind {
  States = /* @__PURE__ */ new Map();
  OnPlaced(Building, Now) {
    this.States.set(Building, { ArmedAt: Now + this.Settings.ArmTime });
  }
  OnRemoved(Building) {
    this.States.delete(Building);
  }
  Tick(Building, Now, DeltaTime) {
    if (!this.IsArmed(Building, Now)) {
      return;
    }
    const Origin = VectorMath.Add(Building.Position, { x: 0, y: 0, z: this.Settings.BlastHeight });
    const Victim = this.FindVictim(Building);
    if (Victim) {
      Console10.Log(`${LogPrefix} ${GetPawnName(Victim)} set off ${GetPawnName(Building.Owner)}'s ${this.Settings.DisplayName}`);
      Building.DamageDealt += Explode(Origin, Building.Owner, this.Settings.BlastRadius, this.Settings.Damage, this.Settings.Knockback, void 0, this.Settings.ExplodeFxTemplate);
      RemoveBuilding(Building);
    } else if (this.IsOwnerOnIt(Building)) {
      SpawnExplosionFx(Origin, this.Settings.BlastRadius, this.Settings.ExplodeFxTemplate);
      this.LaunchOwner(Building);
      RemoveBuilding(Building);
    }
  }
  GetColor(Building, Now) {
    return this.IsArmed(Building, Now) ? void 0 : UnarmedTrapColor;
  }
  GetStatus(Building, Now) {
    return this.IsArmed(Building, Now) ? "Armed" : "Arming";
  }
  IsArmed(Building, Now) {
    const State = this.States.get(Building);
    return State !== void 0 && Now >= State.ArmedAt;
  }
  IsOwnerOnIt(Building) {
    const Owner = Building.Owner;
    return Owner.IsValid() && Owner.IsAlive() && IsStandingOn(Building, Owner, this.Settings.TriggerReach, this.Settings.TriggerHeight);
  }
  LaunchOwner(Building) {
    const Owner = Building.Owner;
    const Feet = Owner.GetAbsOrigin();
    const Away = VectorMath.GetSafeNormal({ x: Feet.x - Building.Position.x, y: Feet.y - Building.Position.y, z: 0 });
    const Launch = VectorMath.Add(VectorMath.Scale(Away, this.Settings.OwnerLaunchSpeed), { x: 0, y: 0, z: this.Settings.OwnerLaunchUpSpeed });
    Console10.Log(`${LogPrefix} ${GetPawnName(Owner)} stepped on their own ${this.Settings.DisplayName}`);
    Owner.Teleport({ velocity: Launch });
    Owner.TakeDamage(
      {
        damage: this.Settings.OwnerDamage,
        damageTypes: CSDamageTypes3.BLAST,
        damageFlags: CSDamageFlags2.IGNORE_ARMOR,
        attacker: Owner,
        inflictor: Owner
      }
    );
  }
  FindVictim(Building) {
    let Victim = void 0;
    ForEachLivePawn((Pawn) => {
      if (!Victim && IsBuildingEnemy(Building, Pawn) && IsStandingOn(Building, Pawn, this.Settings.TriggerReach, this.Settings.TriggerHeight)) {
        Victim = Pawn;
      }
    });
    return Victim;
  }
};
var TeleporterKind = class extends BuildingKind {
  Partner = void 0;
  bEntrance;
  States = /* @__PURE__ */ new Map();
  constructor(Settings, bEntrance) {
    super(Settings);
    this.bEntrance = bEntrance;
  }
  GetBotSite() {
    return this.bEntrance ? 1 /* AtSpawn */ : 2 /* AwayFromSpawn */;
  }
  OnPlaced(Building, Now) {
    this.States.set(Building, { ReadyAt: Now });
  }
  OnRemoved(Building) {
    this.States.delete(Building);
  }
  OnDestroyed(Building) {
    const Other = this.FindPartner(Building);
    if (Other) {
      DestroyBuilding(Other);
    }
  }
  Tick(Building, Now, DeltaTime) {
    const Exit = this.FindPartner(Building);
    const State = this.States.get(Building);
    if (!this.bEntrance || !Exit || !State) {
      return;
    }
    Instance10.DebugLine({ start: GetBuildingCenter(Building), end: GetBuildingCenter(Exit), duration: TickInterval * 2, color: GetTeamColor(Building.Owner) });
    if (Now < State.ReadyAt) {
      return;
    }
    const Traveller = this.FindTraveller(Building);
    if (Traveller) {
      this.Send(Traveller, Building, Exit);
      State.ReadyAt = Now + this.Settings.RechargeTime;
    }
  }
  GetColor(Building, Now) {
    return this.IsRecharging(Building, Now) ? this.Settings.RechargeColor : void 0;
  }
  GetStatus(Building, Now) {
    if (!this.FindPartner(Building)) {
      return this.bEntrance ? "Needs exit" : "Needs entrance";
    }
    return this.IsRecharging(Building, Now) ? "Recharging" : "Ready";
  }
  // Both ends count as recharging after a trip, since the wait is kept on the entrance
  IsRecharging(Building, Now) {
    const Entrance = this.bEntrance ? Building : this.FindPartner(Building);
    const EntranceKind = this.bEntrance ? this : this.Partner;
    const State = Entrance && EntranceKind ? EntranceKind.States.get(Entrance) : void 0;
    return State !== void 0 && Now < State.ReadyAt;
  }
  FindPartner(Building) {
    return this.Partner ? FindOwnedBuilding(Building.OwnerSlot, this.Partner) : void 0;
  }
  FindTraveller(Building) {
    let Traveller = void 0;
    ForEachLivePawn((Pawn) => {
      if (!Traveller && !IsBuildingEnemy(Building, Pawn) && IsStandingOn(Building, Pawn, this.Settings.HalfWidth, this.Settings.StandHeight)) {
        Traveller = Pawn;
      }
    });
    return Traveller;
  }
  Send(Traveller, Entrance, Exit) {
    const Arrival = VectorMath.Add(Exit.Position, { x: 0, y: 0, z: Exit.Kind.Settings.Height + ArrivalLift });
    SpawnTemporaryTemplate(this.Settings.TeleportFxTemplate, GetBuildingCenter(Entrance), TeleportFxLifetime);
    SpawnTemporaryTemplate(this.Settings.TeleportFxTemplate, Arrival, TeleportFxLifetime);
    Traveller.Teleport({ position: Arrival, angles: { pitch: 0, yaw: Exit.Yaw, roll: 0 }, velocity: ZeroVector });
    Traveller.SetEyeAngles({ pitch: Traveller.GetEyeAngles().pitch, yaw: Exit.Yaw, roll: 0 });
    Console10.Log(`${LogPrefix} ${GetPawnName(Traveller)} took ${GetPawnName(Entrance.Owner)}'s teleporter`);
  }
};
var ShrinkerClass = class extends PlayerClass {
  Trap = new TrapKind(ShrinkerSettings.Trap);
  Entrance = new TeleporterKind(ShrinkerSettings.TeleporterEntrance, true);
  Exit = new TeleporterKind(ShrinkerSettings.TeleporterExit, false);
  BuildKeys = { Left: { Label: "Traps", Kinds: [this.Trap] }, Right: { Label: "Teleporters", Kinds: [this.Entrance, this.Exit] } };
  PlayerStates = /* @__PURE__ */ new Map();
  constructor() {
    super(ShrinkerSettings);
    this.Entrance.Partner = this.Exit;
    this.Exit.Partner = this.Entrance;
  }
  TickPlayer(Pawn, Slot, Now, DeltaTime) {
    const State = this.GetPlayerState(Slot);
    const bLeftPressed = ConsumePress(Pawn, State.Held, CSInputs5.ATTACK);
    const bRightPressed = ConsumePress(Pawn, State.Held, CSInputs5.ATTACK2);
    TickBuildTool(Pawn, Slot, this.GetBuildKeys(Pawn), bLeftPressed, bRightPressed, Now);
    const bWasShrunk = State.bWantsShrunk;
    if (bRightPressed && IsKnife(GetHeldWeapon(Pawn))) {
      this.ToggleShrink(State);
    }
    this.TickCharge(State, DeltaTime);
    if (State.bWantsShrunk !== bWasShrunk) {
      PlaySoundOn(State.bWantsShrunk ? this.Settings.ShrinkSound : this.Settings.GrowSound, Pawn);
    }
    this.TickSize(Pawn, State, DeltaTime);
  }
  GetBuildKeys(Pawn) {
    return IsWeapon(GetHeldWeapon(Pawn), this.Settings.Primary) ? this.BuildKeys : void 0;
  }
  GetBotBuildTool(Pawn) {
    return Pawn.FindWeapon(this.Settings.Primary);
  }
  ClearPlayer(Slot) {
    CancelPlacement(Slot);
    this.PlayerStates.delete(Slot);
  }
  GetHudCounter(Slot) {
    const State = this.PlayerStates.get(Slot);
    return { Label: "Shrink", Count: Math.floor(State ? State.Charge : MaxShrinkCharge), Max: MaxShrinkCharge };
  }
  ToggleShrink(State) {
    const bSettled = State.ShrinkAlpha === (State.bWantsShrunk ? 1 : 0);
    if (bSettled && (State.bWantsShrunk || State.Charge >= this.Settings.MinShrinkCharge)) {
      State.bWantsShrunk = !State.bWantsShrunk;
    }
  }
  TickCharge(State, DeltaTime) {
    if (State.bWantsShrunk) {
      State.Charge = Math.max(0, State.Charge - MaxShrinkCharge * DeltaTime / this.Settings.ShrunkDuration);
      State.bWantsShrunk = State.Charge > 0;
    } else if (State.ShrinkAlpha === 0) {
      State.Charge = Math.min(MaxShrinkCharge, State.Charge + MaxShrinkCharge * DeltaTime / this.Settings.RechargeTime);
    }
  }
  TickSize(Pawn, State, DeltaTime) {
    const Target = State.bWantsShrunk ? 1 : 0;
    if (State.ShrinkAlpha === Target) {
      return;
    }
    const Duration = State.bWantsShrunk ? this.Settings.ShrinkTime : this.Settings.GrowTime;
    const Step = Duration > 0 ? DeltaTime / Duration : 1;
    State.ShrinkAlpha = State.bWantsShrunk ? Math.min(1, State.ShrinkAlpha + Step) : Math.max(0, State.ShrinkAlpha - Step);
    const Eased = State.ShrinkAlpha * State.ShrinkAlpha * (3 - 2 * State.ShrinkAlpha);
    Pawn.SetModelScale(this.Settings.SizeScale + (this.Settings.ShrunkScale - this.Settings.SizeScale) * Eased);
  }
  GetPlayerState(Slot) {
    return GetOrCreate(this.PlayerStates, Slot, () => {
      return { Charge: MaxShrinkCharge, bWantsShrunk: false, ShrinkAlpha: 0, Held: { Mask: 0 } };
    });
  }
};

// src/classes/bm_gunner.ts
import { Instance as Instance11, CSInputs as CSInputs6, CSGearSlot as CSGearSlot3 } from "cs_script/point_script";
var GunnerSettings = {
  DisplayName: "Builder",
  PickFxTemplate: "gunner_pick_template",
  Primary: "weapon_mag7",
  Secondary: "",
  Melee: "weapon_spanner",
  Health: 125,
  SizeScale: 1.1,
  Model: "agents/models/otakku/gordon_freeman/gordon_freeman.vmdl",
  bStartWithMelee: true,
  MeleeDamage: 0,
  RepairPerHit: 25,
  PrimaryLauncher: {
    FireInterval: 0.75,
    ClipSize: 6,
    ReloadFirstTime: 2,
    ReloadEachTime: 0,
    ChargeTime: 0,
    DeployTime: 0.1,
    FireFxTemplate: "gunner_shot_fire_template",
    ReloadFxTemplate: "gunner_shot_reload_template"
  },
  SecondaryLauncher: void 0,
  Shotgun: {
    Damage: 12,
    HeadshotMultiplier: 1,
    Range: 2048,
    Spread: 5,
    Pellets: 8,
    bPierces: false,
    Falloff: BeamerShotgunFalloff,
    Knockback: 250,
    SelfKnockback: 150,
    bBloodSplatter: true,
    bHeldBeam: false,
    BeamTemplate: "gunner_shot_tracer_template",
    BeamEndName: "gunner_shot_tracer_end",
    BeamLifetime: 0.06,
    ImpactTemplate: "",
    ImpactLifetime: 0
  },
  HeavyTurret: {
    DisplayName: "Heavy Turret",
    ModelTemplate: "gunner_heavy_turret_template",
    DestroyFxTemplate: "gunner_turret_destroy_template",
    Health: 75,
    HalfWidth: 18,
    Height: 48,
    ThrowSpeed: 450,
    MaxCount: 1,
    RebuildDelay: 10,
    FireInterval: 2,
    ArmTime: 1,
    MuzzleHeight: 40,
    Gun: {
      Damage: 40,
      HeadshotMultiplier: 1,
      Range: 1600,
      Spread: 0,
      Pellets: 1,
      bPierces: false,
      Falloff: [],
      Knockback: 1200,
      SelfKnockback: 0,
      bBloodSplatter: true,
      bHeldBeam: false,
      BeamTemplate: "gunner_heavy_turret_tracer_template",
      BeamEndName: "gunner_heavy_turret_tracer_end",
      BeamLifetime: 0.2,
      ImpactTemplate: "",
      ImpactLifetime: 0
    }
  },
  RapidTurret: {
    DisplayName: "Rapid Turret",
    ModelTemplate: "gunner_rapid_turret_template",
    DestroyFxTemplate: "gunner_turret_destroy_template",
    Health: 50,
    HalfWidth: 16,
    Height: 40,
    ThrowSpeed: 450,
    MaxCount: 1,
    RebuildDelay: 10,
    FireInterval: 0.12,
    ArmTime: 1,
    MuzzleHeight: 32,
    Gun: {
      Damage: 4,
      HeadshotMultiplier: 1,
      Range: 1200,
      Spread: 2,
      Pellets: 1,
      bPierces: false,
      Falloff: [],
      Knockback: 2e3,
      SelfKnockback: 0,
      bBloodSplatter: false,
      bHeldBeam: false,
      BeamTemplate: "gunner_rapid_turret_tracer_template",
      BeamEndName: "gunner_rapid_turret_tracer_end",
      BeamLifetime: 0.05,
      ImpactTemplate: "",
      ImpactLifetime: 0
    }
  }
};
var MaxTurrets = 2;
var TurretKind = class extends BuildingKind {
  States = /* @__PURE__ */ new Map();
  OnPlaced(Building, Now) {
    this.States.set(Building, { ArmedAt: Now + this.Settings.ArmTime, NextFireTime: Now + this.Settings.ArmTime });
  }
  OnRemoved(Building) {
    this.States.delete(Building);
  }
  Tick(Building, Now, DeltaTime) {
    const State = this.States.get(Building);
    const Muzzle = VectorMath.Add(Building.Position, { x: 0, y: 0, z: this.Settings.MuzzleHeight });
    const Target = State ? this.FindTarget(Building, Muzzle) : void 0;
    if (!State || !Target) {
      return;
    }
    const Chest = GetChestPosition(Target);
    const Aim = VectorMath.GetRotation(VectorMath.Subtract(Chest, Muzzle));
    TurnBuilding(Building, Aim.yaw);
    Instance11.DebugLine({ start: Muzzle, end: Chest, duration: TickInterval * 2, color: GetTeamColor(Building.Owner) });
    if (Now < State.NextFireTime) {
      return;
    }
    State.NextFireTime = Now + this.Settings.FireInterval;
    Building.DamageDealt += FireHitscan(Building.Owner, this.Settings.Gun, void 0, Muzzle, Aim, Muzzle);
  }
  GetStatus(Building, Now) {
    const State = this.States.get(Building);
    return State && Now < State.ArmedAt ? "Arming" : `${Math.round(Building.DamageDealt)} dmg`;
  }
  FindTarget(Building, Muzzle) {
    const Ignored = GetBuildingEntities(Building);
    let Target = void 0;
    let TargetDistance = this.Settings.Gun.Range;
    ForEachLivePawn((Pawn) => {
      if (!IsBuildingEnemy(Building, Pawn)) {
        return;
      }
      const Chest = GetChestPosition(Pawn);
      const Distance = VectorMath.Size(VectorMath.Subtract(Chest, Muzzle));
      if (Distance > TargetDistance) {
        return;
      }
      const Sight = Instance11.TraceLine({ start: Muzzle, end: Chest, ignorePlayers: true, ignoreEntity: Ignored });
      if (Sight.didHit && !Sight.startedInSolid) {
        return;
      }
      Target = Pawn;
      TargetDistance = Distance;
    });
    return Target;
  }
};
var GunnerClass = class extends PlayerClass {
  HeavyTurret = new TurretKind(GunnerSettings.HeavyTurret);
  RapidTurret = new TurretKind(GunnerSettings.RapidTurret);
  BuildKeys = { Left: { Label: "Heavy Turret", Kinds: [this.HeavyTurret] }, Right: { Label: "Rapid Turret", Kinds: [this.RapidTurret] } };
  PlayerStates = /* @__PURE__ */ new Map();
  constructor() {
    super(GunnerSettings);
  }
  GetBotShot(WeaponName) {
    return GetHitscanBotShot(this.Settings.Shotgun);
  }
  GetBotBuildTool(Pawn) {
    return Pawn.FindWeaponBySlot(CSGearSlot3.KNIFE);
  }
  OnPrimaryFire(Pawn, Slot, Now) {
    FireHitscanWeapon(Pawn, this.Settings.Shotgun, Pawn.FindWeapon(this.Settings.Primary));
  }
  TickPlayer(Pawn, Slot, Now, DeltaTime) {
    const State = this.GetPlayerState(Slot);
    const bLeftPressed = ConsumePress(Pawn, State.Held, CSInputs6.ATTACK);
    const bRightPressed = ConsumePress(Pawn, State.Held, CSInputs6.ATTACK2);
    const bRepairing = (bLeftPressed || bRightPressed) && GetPlacingKind(Slot) === void 0 && IsRepairingBuilding(Pawn, Slot, Now);
    TickBuildTool(Pawn, Slot, this.GetBuildKeys(Pawn), bLeftPressed && !bRepairing, bRightPressed && !bRepairing, Now);
  }
  GetBuildKeys(Pawn) {
    return IsKnife(GetHeldWeapon(Pawn)) ? this.BuildKeys : void 0;
  }
  ClearPlayer(Slot) {
    CancelPlacement(Slot);
    this.PlayerStates.delete(Slot);
  }
  GetHudCounter(Slot) {
    return { Label: "Turrets", Count: GetOwnedBuildings(Slot).length, Max: MaxTurrets };
  }
  GetPlayerState(Slot) {
    return GetOrCreate(this.PlayerStates, Slot, () => {
      return { Held: { Mask: 0 } };
    });
  }
};

// src/classes/bm_classlist.ts
var ClassDefinitions = {
  ["demo" /* Demoman */]: new DemomanClass(),
  ["soldier" /* Solider */]: new SoldierClass(),
  ["medic" /* Medic */]: new MedicClass(),
  ["railer" /* Railer */]: new RailerClass(),
  ["beamer" /* Beamer */]: new BeamerClass(),
  ["boxer" /* Boxer */]: new BoxerClass(),
  ["shocker" /* Shocker */]: new ShockerClass(),
  ["shrinker" /* Shrinker */]: new ShrinkerClass(),
  ["builder" /* Gunner */]: new GunnerClass()
};
function GiveLoadout(Pawn, PlayerClass3) {
  ClassDefinitions[PlayerClass3].ApplyLoadout(Pawn);
}
function IsWeaponAllowed(PlayerClass3, Weapon) {
  const Data = Weapon.GetData();
  if (!Data || Data.GetGearSlot() === CSGearSlot4.C4) {
    return true;
  }
  const bIsKnife = Data.GetType() === CSWeaponType3.KNIFE;
  if (PlayerClass3 === "none" /* None */) {
    return bIsKnife;
  }
  const Settings = ClassDefinitions[PlayerClass3].Settings;
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

// src/bm_ui.ts
import { Console as Console11, CSInputs as CSInputs7 } from "cs_script/point_script";
var ClassUiName = "class_hud";
var MenuPanelId = "ClassMenu";
var HudCardsId = "HudCards";
var CentreBarId = "CentreBar";
var IndicatorPanelId = "ClassIndicator";
var ClassNameLabelId = "ClassName";
var PickButtonPrefix = "Pick_";
var PickStatsPrefix = "PickStats_";
var CloseButtonId = "CloseMenu";
var MenuToggleKey = CSInputs7.USE;
var NoClassName = "No class";
var AmmoPanelId = "AmmoPanel";
var AmmoClipLabelId = "AmmoClip";
var AmmoSpareLabelId = "AmmoSpare";
var HealthPanelId = "HealthPanel";
var HealthValueLabelId = "HealthValue";
var HealthMaxLabelId = "HealthMax";
var HealthCrossFillId = "HealthCrossFill";
var HealthCrossFillPrefix = "Fill_";
var HealthCrossSteps = 20;
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
var BuildingPanelId = "BuildingPanel";
var BuildingRowPrefix = "BuildingRow";
var BuildingNamePrefix = "BuildingName";
var BuildingStatusPrefix = "BuildingStatus";
var BuildingHealthPrefix = "BuildingHealth";
var BuildingHealthTextPrefix = "BuildingHealthText";
var MaxBuildingRows = 4;
var BuildHintPrefix = "BuildHint";
var BuildHintSides = ["Left", "Right"];
var AllBuildHintStates = Object.values(EBuildHint);
var AllClasses = Object.values(EPlayerClass);
var GOpenMenus = /* @__PURE__ */ new Set();
var GOfferedMenus = /* @__PURE__ */ new Set();
var GShownAmmo = /* @__PURE__ */ new Map();
var GShownHealth = /* @__PURE__ */ new Map();
var GShownCrossSteps = /* @__PURE__ */ new Map();
var GShownBars = /* @__PURE__ */ new Map();
var GShownCounter = /* @__PURE__ */ new Map();
var GSentPayload = /* @__PURE__ */ new Map();
var GShownBuildings = /* @__PURE__ */ new Map();
var TargetIdPanelId = "TargetId";
var TargetIdNameId = "TargetIdName";
var TargetIdHealthId = "TargetIdHealth";
var TargetIdBarId = "TargetIdBar";
var TargetIdOverhealBarId = "TargetIdOverhealBar";
var GShownTargetIds = /* @__PURE__ */ new Map();
var GShownBuildHints = /* @__PURE__ */ new Map();
var LeaderboardPanelId = "Leaderboard";
var LeaderboardRowPrefix = "LeaderboardRow";
var LeaderboardYouId = "LeaderboardYou";
var MaxLeaderboardRows = 8;
var GShownLeaderboard = [];
var GShownLeaderboardYou = /* @__PURE__ */ new Map();
var TeamBoardPanelId = "TeamBoard";
var TeamBoardGoalId = "TeamBoardGoal";
var TeamBoardSides = ["T", "CT"];
var MaxTeamBoardRows = 8;
var GShownTeamBoard = /* @__PURE__ */ new Map();
var GShownTeamBoardYou = /* @__PURE__ */ new Map();
var GbWarnedNoClassUi = false;
function OpenClassMenu(Slot) {
  const Ui = FindClassUi();
  if (!Ui) {
    return;
  }
  GOpenMenus.add(Slot);
  SetMenuOpen(Ui, Slot, true);
}
function CloseClassMenu(Slot) {
  GOpenMenus.delete(Slot);
  const Ui = FindClassUi();
  if (!Ui) {
    return;
  }
  SetMenuOpen(Ui, Slot, false);
}
function SetMenuOpen(Ui, Slot, bOpen) {
  if (bOpen) {
    ShowClassStats(Ui, Slot);
  }
  Ui.SetHasClassForPlayer(Slot, MenuPanelId, "Open", bOpen);
  Ui.SetHasClassForPlayer(Slot, HudCardsId, "MenuOpen", bOpen);
  Ui.SetInputCaptureEnabled(Slot, bOpen);
}
function ShowClassStats(Ui, Slot) {
  for (const Choice of AllClasses) {
    if (Choice === "none" /* None */) {
      continue;
    }
    const Settings = ClassDefinitions[Choice].Settings;
    const Scale = Number.isInteger(Settings.SizeScale) ? Settings.SizeScale.toFixed(1) : String(Number(Settings.SizeScale.toFixed(2)));
    Ui.SetDialogVariableStringForPlayer(Slot, `${PickStatsPrefix}${Choice}`, "stats", `${Settings.Health}hp ${Scale}x`);
  }
}
function ToggleClassMenu(Slot) {
  if (GOpenMenus.has(Slot)) {
    CloseClassMenu(Slot);
  } else {
    OpenClassMenu(Slot);
  }
}
function OfferClassMenu(Slot, PlayerClass3) {
  if (GOfferedMenus.has(Slot) || PlayerClass3 !== "none" /* None */) {
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
  for (const PlayerClass3 of AllClasses) {
    if (PlayerClass3 === ClassValue) {
      return PlayerClass3;
    }
  }
  return void 0;
}
function ShowClassIndicator(Slot, PlayerClass3, IsT) {
  const Ui = FindClassUi();
  if (!Ui) {
    return;
  }
  const DisplayName = PlayerClass3 === "none" /* None */ ? NoClassName : ClassDefinitions[PlayerClass3].Settings.DisplayName;
  Ui.SetDialogVariableStringForPlayer(Slot, ClassNameLabelId, "classname", DisplayName);
  Ui.SetHasClassForPlayer(Slot, HudCardsId, "Team_t", IsT);
  Ui.SetHasClassForPlayer(Slot, HudCardsId, "Team_ct", !IsT);
  Ui.SetHasClassForPlayer(Slot, IndicatorPanelId, "Shown", true);
  for (const Choice of AllClasses) {
    Ui.SetHasClassForPlayer(Slot, `${PickButtonPrefix}${Choice}`, "Current", Choice === PlayerClass3);
  }
  if (GOpenMenus.has(Slot)) {
    SetMenuOpen(Ui, Slot, true);
  }
}
function ShowAmmo(Slot, Ammo) {
  ShowBar(Slot, ChargeBarId, Ammo && Ammo.ChargeFraction > 0 ? Ammo.ChargeFraction : void 0);
  ShowBar(Slot, ReloadBarId, Ammo && Ammo.bReloading ? Ammo.ReloadFraction : void 0);
  const Key = Ammo ? `${Ammo.Clip}|${Ammo.MaxClip}|${Ammo.bReloading}` : "";
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
function ShowBuildings(Slot, Rows) {
  const Shown = GetOrCreate(GShownBuildings, Slot, () => {
    return [];
  });
  let Ui = void 0;
  for (let Index = 0; Index <= MaxBuildingRows; Index++) {
    const Row = Index < MaxBuildingRows ? Rows[Index] : void 0;
    const bPanel = Index === MaxBuildingRows;
    const Key = bPanel ? Rows.length > 0 ? "Shown" : "" : Row ? `${Row.Name}|${Row.Health}|${Row.MaxHealth}|${Row.Status}` : "";
    if ((Shown[Index] ?? "") === Key) {
      continue;
    }
    Ui ??= FindClassUi();
    if (!Ui) {
      return;
    }
    Shown[Index] = Key;
    if (bPanel) {
      Ui.SetHasClassForPlayer(Slot, BuildingPanelId, "Shown", Rows.length > 0);
      continue;
    }
    const RowId = `${BuildingRowPrefix}${Index}`;
    if (!Row) {
      Ui.SetHasClassForPlayer(Slot, RowId, "Shown", false);
      continue;
    }
    const Fraction = Row.MaxHealth > 0 ? Row.Health / Row.MaxHealth : 0;
    Ui.SetDialogVariableStringForPlayer(Slot, `${BuildingNamePrefix}${Index}`, "name", Row.Name);
    Ui.SetDialogVariableStringForPlayer(Slot, `${BuildingStatusPrefix}${Index}`, "status", Row.Status);
    Ui.SetDialogVariableStringForPlayer(Slot, `${BuildingHealthTextPrefix}${Index}`, "health", `${Row.Health} / ${Row.MaxHealth}`);
    ShowBar(Slot, `${BuildingHealthPrefix}${Index}`, Fraction);
    Ui.SetHasClassForPlayer(Slot, RowId, "Hurt", Fraction <= HurtHealthFraction);
    Ui.SetHasClassForPlayer(Slot, RowId, "Critical", Fraction <= CriticalHealthFraction);
    Ui.SetHasClassForPlayer(Slot, RowId, "Shown", true);
  }
}
function ShowBuildHints(Slot, Hints) {
  const Shown = GetOrCreate(GShownBuildHints, Slot, () => {
    return [];
  });
  const Sides = [Hints?.Left, Hints?.Right];
  let Ui = void 0;
  for (let Index = 0; Index < Sides.length; Index++) {
    const Hint = Sides[Index];
    const Key = Hint ? `${Hint.Name}|${Hint.Detail}|${Hint.State}` : "";
    if ((Shown[Index] ?? "") === Key) {
      continue;
    }
    Ui ??= FindClassUi();
    if (!Ui) {
      return;
    }
    Shown[Index] = Key;
    const PanelId = `${BuildHintPrefix}${BuildHintSides[Index]}`;
    if (!Hint) {
      Ui.SetHasClassForPlayer(Slot, PanelId, "Shown", false);
      continue;
    }
    const Words = Hint.Name.split(" ");
    Ui.SetDialogVariableStringForPlayer(Slot, `${PanelId}Word0`, "word", Words[0] ?? "");
    Ui.SetDialogVariableStringForPlayer(Slot, `${PanelId}Word1`, "word", Words.slice(1).join(" "));
    Ui.SetDialogVariableStringForPlayer(Slot, `${PanelId}Detail`, "detail", Hint.Detail);
    Ui.SetHasClassForPlayer(Slot, PanelId, "HasWord1", Words.length > 1);
    Ui.SetHasClassForPlayer(Slot, PanelId, "HasDetail", Hint.Detail !== "");
    for (const State of AllBuildHintStates) {
      Ui.SetHasClassForPlayer(Slot, PanelId, State, State === Hint.State);
    }
    Ui.SetHasClassForPlayer(Slot, PanelId, "Shown", true);
  }
}
function ShowTargetId(Slot, Target) {
  const Key = Target ? `${Target.Name}|${Target.Health}|${Target.MaxHealth}|${Target.MaxOverheal}|${Target.bTerrorist}` : "";
  if ((GShownTargetIds.get(Slot) ?? "") === Key) {
    return;
  }
  const Ui = FindClassUi();
  if (!Ui) {
    return;
  }
  GShownTargetIds.set(Slot, Key);
  if (!Target) {
    Ui.SetHasClassForPlayer(Slot, TargetIdPanelId, "Shown", false);
    ShowBar(Slot, TargetIdBarId, void 0);
    ShowBar(Slot, TargetIdOverhealBarId, void 0);
    return;
  }
  Ui.SetDialogVariableStringForPlayer(Slot, TargetIdNameId, "name", Target.Name);
  Ui.SetDialogVariableStringForPlayer(Slot, TargetIdHealthId, "health", `${Target.Health} / ${Target.MaxHealth}`);
  Ui.SetHasClassForPlayer(Slot, TargetIdPanelId, "Team_t", Target.bTerrorist);
  Ui.SetHasClassForPlayer(Slot, TargetIdPanelId, "Team_ct", !Target.bTerrorist);
  ShowBar(Slot, TargetIdBarId, Target.Health / Math.max(1, Target.MaxHealth));
  const bOverhealed = Target.Health > Target.MaxHealth;
  ShowBar(Slot, TargetIdOverhealBarId, bOverhealed ? (Target.Health - Target.MaxHealth) / Math.max(1, Target.MaxOverheal - Target.MaxHealth) : void 0);
  Ui.SetHasClassForPlayer(Slot, TargetIdPanelId, "Overhealed", bOverhealed);
  Ui.SetHasClassForPlayer(Slot, TargetIdPanelId, "Shown", true);
}
function ShowLeaderboard(Rows) {
  let Ui = void 0;
  for (let Index = 0; Index <= MaxLeaderboardRows; Index++) {
    const bPanel = Index === MaxLeaderboardRows;
    const Row = Rows && !bPanel ? Rows[Index] : void 0;
    const Key = bPanel ? Rows ? "Shown" : "" : Row ? GetLeaderboardKey(Row) : "";
    if ((GShownLeaderboard[Index] ?? "") === Key) {
      continue;
    }
    Ui ??= FindClassUi();
    if (!Ui) {
      return;
    }
    GShownLeaderboard[Index] = Key;
    if (bPanel) {
      Ui.SetHasClass(LeaderboardPanelId, "Shown", Rows !== void 0);
      continue;
    }
    if (Row) {
      SetLeaderboardRow(Ui, void 0, `${Index}`, Index + 1, Row);
    }
    Ui.SetHasClass(`${LeaderboardRowPrefix}${Index}`, "Shown", Row !== void 0);
  }
}
function ShowLeaderboardYou(Slot, Rows) {
  const Index = Rows.findIndex((Row) => {
    return Row.Slot === Slot;
  });
  const Own = Index >= MaxLeaderboardRows ? Rows[Index] : void 0;
  const Key = `${Index}|${Own ? GetLeaderboardKey(Own) : ""}`;
  if (GShownLeaderboardYou.get(Slot) === Key) {
    return;
  }
  const Ui = FindClassUi();
  if (!Ui) {
    return;
  }
  GShownLeaderboardYou.set(Slot, Key);
  for (let Row = 0; Row < MaxLeaderboardRows; Row++) {
    Ui.SetHasClassForPlayer(Slot, `${LeaderboardRowPrefix}${Row}`, "You", Row === Index);
  }
  if (Own) {
    SetLeaderboardRow(Ui, Slot, "You", Index + 1, Own);
  }
  Ui.SetHasClassForPlayer(Slot, LeaderboardYouId, "Shown", Own !== void 0);
}
function ShowTeamLeaderboard(Board) {
  let Ui = void 0;
  const NeedsUpdate = (Id, Key) => {
    if (GShownTeamBoard.get(Id) === Key) {
      return void 0;
    }
    Ui ??= FindClassUi();
    if (Ui) {
      GShownTeamBoard.set(Id, Key);
    }
    return Ui;
  };
  const PanelUi = NeedsUpdate(TeamBoardPanelId, Board ? "Shown" : "");
  PanelUi?.SetHasClass(TeamBoardPanelId, "Shown", Board !== void 0);
  if (!Board) {
    return;
  }
  NeedsUpdate(TeamBoardGoalId, `${Board.KillsToWin}`)?.SetDialogVariableString(TeamBoardGoalId, "goal", `${Board.KillsToWin}`);
  for (const Side of TeamBoardSides) {
    const bTerrorists = Side === "T";
    const Kills = `${bTerrorists ? Board.TerroristKills : Board.CounterTerroristKills}`;
    NeedsUpdate(`TeamBoardScore${Side}`, Kills)?.SetDialogVariableString(`TeamBoardScore${Side}`, "kills", Kills);
    const Rows = bTerrorists ? Board.Terrorists : Board.CounterTerrorists;
    for (let Index = 0; Index < MaxTeamBoardRows; Index++) {
      const Row = Rows[Index];
      const RowId = `TeamBoard${Side}Row${Index}`;
      const RowUi = NeedsUpdate(RowId, Row ? GetLeaderboardKey(Row) : "");
      if (!RowUi) {
        continue;
      }
      if (Row) {
        RowUi.SetDialogVariableString(`TeamBoard${Side}Name${Index}`, "name", Row.Name);
        RowUi.SetDialogVariableString(`TeamBoard${Side}Kills${Index}`, "kills", `${Row.Kills}`);
        RowUi.SetDialogVariableString(`TeamBoard${Side}Damage${Index}`, "damage", `${Row.Damage}`);
      }
      RowUi.SetHasClass(RowId, "Shown", Row !== void 0);
    }
  }
}
function ShowTeamLeaderboardYou(Slot, Board) {
  const IsOwn = (Row) => {
    return Row.Slot === Slot;
  };
  const TerroristIndex = Board.Terrorists.findIndex(IsOwn);
  const OwnRowId = TerroristIndex !== INDEX_NONE ? `TeamBoardTRow${TerroristIndex}` : `TeamBoardCTRow${Board.CounterTerrorists.findIndex(IsOwn)}`;
  if (GShownTeamBoardYou.get(Slot) === OwnRowId) {
    return;
  }
  const Ui = FindClassUi();
  if (!Ui) {
    return;
  }
  GShownTeamBoardYou.set(Slot, OwnRowId);
  for (const Side of TeamBoardSides) {
    for (let Index = 0; Index < MaxTeamBoardRows; Index++) {
      const RowId = `TeamBoard${Side}Row${Index}`;
      Ui.SetHasClassForPlayer(Slot, RowId, "You", RowId === OwnRowId);
    }
  }
}
function GetLeaderboardKey(Row) {
  return `${Row.Slot}|${Row.Name}|${Row.Kills}|${Row.Damage}`;
}
function SetLeaderboardRow(Ui, Slot, Suffix, Rank, Row) {
  const Values = [
    [`LeaderboardRank${Suffix}`, "rank", `${Rank}`],
    [`LeaderboardName${Suffix}`, "name", Row.Name],
    [`LeaderboardKills${Suffix}`, "kills", `${Row.Kills}`],
    [`LeaderboardDamage${Suffix}`, "damage", `${Row.Damage}`]
  ];
  for (const [LabelId, VariableName, Value] of Values) {
    if (Slot === void 0) {
      Ui.SetDialogVariableString(LabelId, VariableName, Value);
    } else {
      Ui.SetDialogVariableStringForPlayer(Slot, LabelId, VariableName, Value);
    }
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
    Ui.SetHasClassForPlayer(Slot, CentreBarId, "Shown", false);
    return;
  }
  const Fraction = Health / MaxHealth;
  Ui.SetDialogVariableStringForPlayer(Slot, HealthValueLabelId, "health", `${Health}`);
  Ui.SetDialogVariableStringForPlayer(Slot, HealthMaxLabelId, "maxhealth", `${MaxHealth}`);
  Ui.SetHasClassForPlayer(Slot, HealthPanelId, "Overhealed", Health > MaxHealth);
  Ui.SetHasClassForPlayer(Slot, HealthPanelId, "Hurt", Fraction <= HurtHealthFraction && Fraction > CriticalHealthFraction);
  Ui.SetHasClassForPlayer(Slot, HealthPanelId, "Critical", Fraction <= CriticalHealthFraction);
  ShowCrossFill(Ui, Slot, Math.ceil(Math.min(1, Math.max(0, Fraction)) * HealthCrossSteps));
  Ui.SetHasClassForPlayer(Slot, CentreBarId, "Shown", true);
}
function ShowCrossFill(Ui, Slot, Step) {
  const LastStep = GShownCrossSteps.get(Slot);
  if (LastStep === Step) {
    return;
  }
  if (LastStep !== void 0) {
    Ui.SetHasClassForPlayer(Slot, HealthCrossFillId, `${HealthCrossFillPrefix}${LastStep}`, false);
  }
  Ui.SetHasClassForPlayer(Slot, HealthCrossFillId, `${HealthCrossFillPrefix}${Step}`, true);
  GShownCrossSteps.set(Slot, Step);
}
function ResetClassUi(Slot) {
  GOpenMenus.delete(Slot);
  GOfferedMenus.delete(Slot);
  GShownAmmo.delete(Slot);
  GShownHealth.delete(Slot);
  GShownCrossSteps.delete(Slot);
  GShownBars.delete(Slot);
  GShownCounter.delete(Slot);
  GSentPayload.delete(Slot);
  GShownBuildings.delete(Slot);
  GShownBuildHints.delete(Slot);
  GShownTargetIds.delete(Slot);
  GShownLeaderboardYou.delete(Slot);
  GShownTeamBoardYou.delete(Slot);
  const Ui = FindClassUi();
  if (!Ui) {
    return;
  }
  Ui.SetInputCaptureEnabled(Slot, false);
  Ui.ResetForPlayer(Slot);
}
function FindClassUi() {
  const Ui = FindEntityByName(ClassUiName);
  if (IsCustomHudLayout2(Ui)) {
    return Ui;
  }
  if (!GbWarnedNoClassUi) {
    GbWarnedNoClassUi = true;
    const Problem = Ui ? "exists but isn't a custom_hud_layout" : "wasn't found";
    Console11.Log(`${LogPrefix} problem finding "${ClassUiName}" ${Problem}. check custom_hud_layout entity`);
  }
  return void 0;
}
function IsCustomHudLayout2(Ent) {
  return Ent !== void 0 && "SetInputCaptureEnabled" in Ent && typeof Ent.SetInputCaptureEnabled === "function";
}

// src/bm_bots.ts
import { Instance as Instance12, Console as Console12, Entities as Entities3, CSInputs as CSInputs8 } from "cs_script/point_script";
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
var BotCombatSettings = {
  SightRange: 2500,
  ViewCone: 75,
  ReactionTime: 0.4,
  AimError: 3,
  AimErrorTime: 0.5,
  MinRating: 10,
  SwitchRatingScale: 1.25,
  DodgeSpeed: 75,
  BlastHitScale: 0.5,
  BuildInterval: 1,
  BuildRetryInterval: 0.25,
  BuildMaxPitch: 45,
  BuildYawSpread: 30,
  BuildSpawnRange: 700,
  BuildFrontDistance: 1200,
  BuildEnemyRange: 1500,
  BuildEnemyMemory: 8
};
var BotPersonalities = [
  { Name: "aggressive", MinRatingScale: 0.5, ReactionScale: 0.5, AimErrorScale: 1.5, ChaseSpeed: 250 },
  { Name: "steady", MinRatingScale: 1, ReactionScale: 1, AimErrorScale: 1, ChaseSpeed: 0 },
  { Name: "careful", MinRatingScale: 2, ReactionScale: 1.25, AimErrorScale: 0.5, ChaseSpeed: 0 }
];
var FallbackPersonality = { Name: "steady", MinRatingScale: 1, ReactionScale: 1, AimErrorScale: 1, ChaseSpeed: 0 };
var ChaseStopDistance = 150;
var BotTargetRadius = 16;
var UnratedInterval = 1;
var BotRespawnGap = 0.5;
var BotDrawInterval = 0.5;
var GBotAssignments = /* @__PURE__ */ new Map();
var GBotReadyAt = /* @__PURE__ */ new Map();
var GBotFighters = /* @__PURE__ */ new Map();
var GBotPersonalities = /* @__PURE__ */ new Map();
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
  GBotReadyAt.set(Slot, Instance12.GetGameTime() + BotSpawnSettleTime);
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
    for (const Marker of Entities3.FindByName(MarkerName)) {
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
function TickBotCombat(Pawn, Slot, Now, Definition) {
  const Controller = Pawn.GetPlayerController();
  if (!Controller || !Controller.IsBot()) {
    return;
  }
  const Weapons = Definition.GetBotWeapons();
  const Tool = Definition.GetBotBuildTool(Pawn);
  if (GBotAssignments.has(Slot) || Weapons.length === 0 && !Tool) {
    SetBotControl(Slot, void 0);
    return;
  }
  const Fighter = GetOrCreate(GBotFighters, Slot, () => {
    return { WeaponName: void 0, Target: void 0, SeenAt: 0, Error: { pitch: 0, yaw: 0, roll: 0 }, NextErrorTime: 0, NextDrawTime: 0, LastTickTime: 0, bTap: false, BuildAim: { pitch: 0, yaw: 0, roll: 0 }, NextBuildTime: 0, SpawnSpot: Pawn.GetAbsOrigin(), EnemySpot: void 0, EnemySeenAt: 0 };
  });
  if (Now - Fighter.LastTickTime > BotRespawnGap) {
    Fighter.WeaponName = void 0;
    Fighter.Target = void 0;
    Fighter.NextBuildTime = Now + BotCombatSettings.BuildInterval;
    Fighter.SpawnSpot = Pawn.GetAbsOrigin();
    Fighter.EnemySpot = void 0;
  }
  Fighter.LastTickTime = Now;
  const Personality = GetBotPersonality(Slot, Controller);
  const Pick = FindBotTarget(Pawn, Fighter, Definition, Weapons, Personality);
  if ((Pick ? Pick.Target : void 0) !== Fighter.Target) {
    Fighter.Target = Pick ? Pick.Target : void 0;
    Fighter.SeenAt = Now;
  }
  if (Pick) {
    Fighter.WeaponName = Pick.WeaponName !== "" ? Pick.WeaponName : void 0;
    Fighter.EnemySpot = Pick.Target.GetAbsOrigin();
    Fighter.EnemySeenAt = Now;
  }
  const bChasing = Pick !== void 0 && ChaseBotTarget(Pawn, Pick, Personality);
  if (Pick && Pick.Rating >= BotCombatSettings.MinRating * Personality.MinRatingScale) {
    AttackBotTarget(Pawn, Slot, Now, Definition, Fighter, Pick, Personality);
    return;
  }
  if (Pick && bChasing) {
    Pawn.SetEyeAngles(VectorMath.GetRotation(VectorMath.Subtract(GetChestPosition(Pick.Target), Pawn.GetEyePosition())));
  } else if (Tool && TickBotBuilding(Pawn, Slot, Now, Definition, Fighter, Tool)) {
    return;
  }
  const WeaponName = Fighter.WeaponName ?? Weapons[0];
  const Weapon = WeaponName !== void 0 ? Pawn.FindWeapon(WeaponName) : void 0;
  DrawBotWeapon(Pawn, Fighter, Weapon, Now);
  SetBotControl(Slot, { Inputs: 0, Weapon, Aim: Pawn.GetEyeAngles() });
}
function ForgetBotCombat(Slot) {
  GBotFighters.delete(Slot);
  GBotPersonalities.delete(Slot);
  SetBotControl(Slot, void 0);
}
function GetBotPersonality(Slot, Controller) {
  return GetOrCreate(GBotPersonalities, Slot, () => {
    const Personality = BotPersonalities[Math.floor(Math.random() * BotPersonalities.length)] ?? FallbackPersonality;
    Console12.Log(`${LogPrefix} bot ${Controller.GetPlayerName()} is ${Personality.Name}`);
    return Personality;
  });
}
function ChaseBotTarget(Pawn, Pick, Personality) {
  if (Personality.ChaseSpeed <= 0 || Pick.Distance <= ChaseStopDistance) {
    return false;
  }
  if (Pawn.GetGroundEntity()) {
    const Offset = VectorMath.Subtract(Pick.Target.GetAbsOrigin(), Pawn.GetAbsOrigin());
    const Direction = VectorMath.GetSafeNormal({ x: Offset.x, y: Offset.y, z: 0 });
    Pawn.Teleport({ velocity: { x: Direction.x * Personality.ChaseSpeed, y: Direction.y * Personality.ChaseSpeed, z: Pawn.GetAbsVelocity().z } });
  }
  return true;
}
function RateBotShot(Shot, Ballistics, Launcher, Distance, AimError = BotCombatSettings.AimError) {
  if (!Shot) {
    return Infinity;
  }
  if (Distance > Shot.Range) {
    return 0;
  }
  const FlightTime = Ballistics && Ballistics.Speed > 0 ? Distance / Ballistics.Speed : 0;
  const MissAngle = (Shot.Spread + AimError / 2) * Math.PI / 180;
  const MissRadius = Distance * Math.tan(MissAngle) + BotCombatSettings.DodgeSpeed * FlightTime;
  const HitRadius = BotTargetRadius + Shot.BlastRadius * BotCombatSettings.BlastHitScale;
  const HitChance = Math.min(1, Math.pow(HitRadius / Math.max(1, MissRadius), 2));
  return Shot.Damage * EvaluateDamageCurve(Shot.Falloff, Distance) * HitChance / Math.max(TickInterval, GetBotFireInterval(Launcher));
}
function GetBotFireInterval(Launcher) {
  if (!Launcher) {
    return UnratedInterval;
  }
  const Reload = Launcher.ClipSize > 0 ? Launcher.ReloadFirstTime / Launcher.ClipSize + Launcher.ReloadEachTime : 0;
  return Launcher.FireInterval + Reload + (Launcher.bFireOnRelease ? 0 : Launcher.ChargeTime);
}
function GetBotLauncher(Definition, WeaponName) {
  return WeaponName === Definition.Settings.Primary ? Definition.Settings.PrimaryLauncher : Definition.Settings.SecondaryLauncher;
}
function RateBotWeapon(Definition, WeaponName, Distance, Personality) {
  return RateBotShot(Definition.GetBotShot(WeaponName), Definition.GetBallistics(WeaponName), GetBotLauncher(Definition, WeaponName), Distance, BotCombatSettings.AimError * Personality.AimErrorScale);
}
function FindBotTarget(Pawn, Fighter, Definition, Weapons, Personality) {
  const Eye = Pawn.GetEyePosition();
  const Facing = VectorMath.GetForwardVector(Pawn.GetEyeAngles());
  const MinFacing = Math.cos(BotCombatSettings.ViewCone * Math.PI / 180);
  let Best = void 0;
  ForEachLivePawn((Other) => {
    if (Other === Pawn || IsTeammate(Other, Pawn)) {
      return;
    }
    const Chest = GetChestPosition(Other);
    const Offset = VectorMath.Subtract(Chest, Eye);
    const Distance = VectorMath.Size(Offset);
    if (Distance >= BotCombatSettings.SightRange || Other !== Fighter.Target && VectorMath.Dot(VectorMath.GetSafeNormal(Offset), Facing) < MinFacing) {
      return;
    }
    const Sight = Instance12.TraceLine({ start: Eye, end: Chest, ignorePlayers: true });
    if (Sight.didHit && !Sight.startedInSolid) {
      return;
    }
    for (const WeaponName of Weapons.length > 0 ? Weapons : [""]) {
      const Rating = (WeaponName !== "" ? RateBotWeapon(Definition, WeaponName, Distance, Personality) : 0) * (WeaponName === Fighter.WeaponName ? BotCombatSettings.SwitchRatingScale : 1);
      if (!Best || Rating > Best.Rating || Rating === Best.Rating && Distance < Best.Distance) {
        Best = { Target: Other, WeaponName, Rating, Distance };
      }
    }
  });
  return Best;
}
function AttackBotTarget(Pawn, Slot, Now, Definition, Fighter, Pick, Personality) {
  const Weapon = Pawn.FindWeapon(Pick.WeaponName);
  DrawBotWeapon(Pawn, Fighter, Weapon, Now);
  if (Now >= Fighter.NextErrorTime) {
    Fighter.Error = { pitch: GetRandomError() * Personality.AimErrorScale, yaw: GetRandomError() * Personality.AimErrorScale, roll: 0 };
    Fighter.NextErrorTime = Now + BotCombatSettings.AimErrorTime;
  }
  const Eye = Pawn.GetEyePosition();
  const AimPoint = GetAimPoint(Eye, GetChestPosition(Pick.Target), Pick.Target.GetAbsVelocity(), Definition.GetBallistics(Pick.WeaponName));
  const Direct = VectorMath.GetRotation(VectorMath.Subtract(AimPoint, Eye));
  const Aim = { pitch: Direct.pitch + Fighter.Error.pitch, yaw: Direct.yaw + Fighter.Error.yaw, roll: 0 };
  Pawn.SetEyeAngles(Aim);
  const Launcher = GetBotLauncher(Definition, Pick.WeaponName);
  Fighter.bTap = !Fighter.bTap;
  const bReacted = Now - Fighter.SeenAt >= BotCombatSettings.ReactionTime * Personality.ReactionScale;
  const bFire = bReacted && (!Launcher || !Launcher.bFireOnRelease || Fighter.bTap);
  SetBotControl(Slot, { Inputs: bFire ? CSInputs8.ATTACK : 0, Weapon, Aim });
}
function TickBotBuilding(Pawn, Slot, Now, Definition, Fighter, Tool) {
  SetBotControl(Slot, { Inputs: 0, Weapon: Tool, Aim: Fighter.BuildAim });
  const Keys = Definition.GetBuildKeys(Pawn);
  if (!Keys) {
    return false;
  }
  const Hints = GetBuildHints(Slot, Keys, Now);
  const Job = FindBotBuildJob(Pawn, Slot, Now, Fighter, Keys.Left, Hints.Left, CSInputs8.ATTACK) ?? FindBotBuildJob(Pawn, Slot, Now, Fighter, Keys.Right, Hints.Right, CSInputs8.ATTACK2);
  if (!Job) {
    return false;
  }
  DrawBotWeapon(Pawn, Fighter, Tool, Now);
  if (Now < Fighter.NextBuildTime) {
    return true;
  }
  if (Job.State !== "Placing" /* Placing */) {
    Fighter.BuildAim = GetBotBuildAim(Pawn, Now, Fighter, Job.Kind.GetBotSite());
  }
  const bBlocked = Job.State === "Blocked" /* Blocked */;
  Fighter.NextBuildTime = Now + (bBlocked ? BotCombatSettings.BuildRetryInterval : BotCombatSettings.BuildInterval);
  SetBotControl(Slot, { Inputs: bBlocked ? 0 : Job.Input, Weapon: Tool, Aim: Fighter.BuildAim });
  return true;
}
function FindBotBuildJob(Pawn, Slot, Now, Fighter, Key, Hint, Input) {
  if (Hint.State !== "Ready" /* Ready */ && Hint.State !== "Placing" /* Placing */ && Hint.State !== "Blocked" /* Blocked */) {
    return void 0;
  }
  const Placing = GetPlacingKind(Slot);
  if (Placing && Key.Kinds.includes(Placing)) {
    return { Input, Kind: Placing, State: Hint.State };
  }
  const Next = GetNextToBuild(Slot, Key.Kinds);
  return Next && IsBotBuildSite(Pawn, Now, Fighter, Next.GetBotSite()) ? { Input, Kind: Next, State: Hint.State } : void 0;
}
function IsBotBuildSite(Pawn, Now, Fighter, Site) {
  const FromSpawn = VectorMath.Size(VectorMath.Subtract(Pawn.GetAbsOrigin(), Fighter.SpawnSpot));
  if (Site === 1 /* AtSpawn */) {
    return FromSpawn <= BotCombatSettings.BuildSpawnRange;
  }
  return FromSpawn >= BotCombatSettings.BuildFrontDistance || Site === 0 /* NearEnemies */ && GetBotEnemySpot(Pawn, Now, Fighter) !== void 0;
}
function GetBotEnemySpot(Pawn, Now, Fighter) {
  const Spot = Fighter.EnemySpot;
  const bKnown = Spot !== void 0 && Now - Fighter.EnemySeenAt <= BotCombatSettings.BuildEnemyMemory && VectorMath.Size(VectorMath.Subtract(Spot, Pawn.GetAbsOrigin())) <= BotCombatSettings.BuildEnemyRange;
  return bKnown ? Spot : void 0;
}
function GetBotBuildAim(Pawn, Now, Fighter, Site) {
  const Pitch = Math.random() * BotCombatSettings.BuildMaxPitch;
  if (Site === 1 /* AtSpawn */) {
    return { pitch: Pitch, yaw: Math.random() * 360 - 180, roll: 0 };
  }
  const Origin = Pawn.GetAbsOrigin();
  const EnemySpot = Site === 0 /* NearEnemies */ ? GetBotEnemySpot(Pawn, Now, Fighter) : void 0;
  const Onwards = EnemySpot ? VectorMath.Subtract(EnemySpot, Origin) : VectorMath.Subtract(Origin, Fighter.SpawnSpot);
  const Yaw = VectorMath.GetRotation(Onwards).yaw + (Math.random() * 2 - 1) * BotCombatSettings.BuildYawSpread;
  return { pitch: Pitch, yaw: Yaw, roll: 0 };
}
function DrawBotWeapon(Pawn, Fighter, Weapon, Now) {
  if (Now < Fighter.NextDrawTime) {
    return;
  }
  Fighter.NextDrawTime = Now + BotDrawInterval;
  if (Weapon && Pawn.GetActiveWeapon() !== Weapon) {
    Pawn.SwitchToWeapon(Weapon);
  }
}
function GetRandomError() {
  return (Math.random() * 2 - 1) * BotCombatSettings.AimError;
}

// src/bm_pickups.ts
import { Instance as Instance13, Console as Console13, Entities as Entities4 } from "cs_script/point_script";
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
    } else if (bDebug) {
      Instance13.DebugSphere({ center: Kit.Entity.GetAbsOrigin(), radius: 12, duration: TickInterval * 2, color: DebugKitColor });
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
  const Found = new Set(Entities4.FindByName(HealthKitSettings.Name));
  for (const ClassName of KitClassNames) {
    for (const Ent of Entities4.FindByClass(ClassName)) {
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
    Console13.Log(`${LogPrefix} ${Name} picked up a healthkit ${OldHealth} -> ${NewHealth}`);
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

// src/bm_spawnzones.ts
import { Console as Console14, Entities as Entities5 } from "cs_script/point_script";
var SpawnZoneSettings = {
  TerroristZoneName: "spawnzone_t",
  CounterTerroristZoneName: "spawnzone_ct",
  TerroristBarrierName: "barrier_t",
  CounterTerroristBarrierName: "barrier_ct",
  PushOutSpeed: 250
};
var RescanInterval2 = 1;
var TouchRefreshDelay = 0.05;
var SafeHistoryTicks = 16;
var StuckResyncTicks = 32;
var GZones = [];
var GVisitors = /* @__PURE__ */ new Map();
var GNextScanTime = 0;
var GLastScanReport = "";
function TickSpawnZones(Now) {
  if (Now >= GNextScanTime) {
    GNextScanTime = Now + RescanInterval2;
    ScanSpawnZones();
  }
  if (GZones.length === 0) {
    return;
  }
  ForEachLivePawn((Pawn, Slot) => {
    const Visitor = GetVisitor(Slot);
    const EnemyZone = FindEnemyZone(Pawn, Slot);
    if (EnemyZone) {
      Block(Pawn, Visitor, EnemyZone);
      return;
    }
    Visitor.BlockedTicks = 0;
    Visitor.History.push(Pawn.GetAbsOrigin());
    if (Visitor.History.length > SafeHistoryTicks) {
      Visitor.History.shift();
    }
  });
}
function ResetSpawnZones() {
  GVisitors.clear();
  GNextScanTime = 0;
}
function ForgetSpawnZonePlayer(Slot) {
  for (const Zone of GZones) {
    Zone.Touching.delete(Slot);
  }
  GVisitors.delete(Slot);
}
function ForgetSpawnZoneHistory(Slot) {
  GVisitors.delete(Slot);
}
function RefreshSpawnZoneTouches() {
  for (const Zone of GZones) {
    RefreshTouches(Zone);
  }
}
function IsInFriendlySpawnZone(Pawn, Slot) {
  const Team = Pawn.GetTeamNumber();
  return GZones.some((Zone) => {
    return Zone.Team === Team && Zone.Touching.has(Slot) && Zone.Entity.IsValid();
  });
}
function ScanSpawnZones() {
  GZones = GZones.filter((Zone) => {
    return Zone.Entity.IsValid();
  });
  AddZones(SpawnZoneSettings.TerroristZoneName, 2 /* Terrorist */);
  AddZones(SpawnZoneSettings.CounterTerroristZoneName, 3 /* CounterTerrorist */);
  AddZones(SpawnZoneSettings.TerroristBarrierName, 2 /* Terrorist */);
  AddZones(SpawnZoneSettings.CounterTerroristBarrierName, 3 /* CounterTerrorist */);
  TintBarriers(SpawnZoneSettings.TerroristBarrierName, 2 /* Terrorist */);
  TintBarriers(SpawnZoneSettings.CounterTerroristBarrierName, 3 /* CounterTerrorist */);
  const TerroristZones = CountZones(2 /* Terrorist */);
  const CounterTerroristZones = CountZones(3 /* CounterTerrorist */);
  const Report = TerroristZones + CounterTerroristZones > 0 ? `spawn zones: ${TerroristZones} for Ts ("${SpawnZoneSettings.TerroristZoneName}"), ${CounterTerroristZones} for CTs ("${SpawnZoneSettings.CounterTerroristZoneName}")` : "";
  if (Report !== "" && Report !== GLastScanReport) {
    Console14.Log(`${LogPrefix} ${Report}`);
  }
  GLastScanReport = Report;
}
function AddZones(Name, Team) {
  for (const Ent of Entities5.FindByName(`${Name}*`)) {
    const bKnown = GZones.some((Zone2) => {
      return Zone2.Entity === Ent;
    });
    if (bKnown || !Ent.IsValid() || !Ent.GetClassName().startsWith("trigger_")) {
      continue;
    }
    const Zone = { Entity: Ent, Team, Touching: /* @__PURE__ */ new Set() };
    GZones.push(Zone);
    Entities5.ConnectOutput(
      {
        target: Ent,
        output: "OnStartTouch",
        callback: (InputData) => {
          const Slot = GetToucherSlot(InputData.activator);
          if (Slot !== INDEX_NONE) {
            Zone.Touching.add(Slot);
          }
        }
      }
    );
    Entities5.ConnectOutput(
      {
        target: Ent,
        output: "OnEndTouch",
        callback: (InputData) => {
          Zone.Touching.delete(GetToucherSlot(InputData.activator));
        }
      }
    );
    RefreshTouches(Zone);
  }
}
function TintBarriers(Name, Team) {
  for (const Ent of Entities5.FindByName(`${Name}*`)) {
    if (Ent.IsValid() && IsModelEntity(Ent)) {
      Ent.SetColor(GetColorForTeam(Team));
    }
  }
}
function RefreshTouches(Zone) {
  if (!Zone.Entity.IsValid()) {
    return;
  }
  Zone.Touching.clear();
  Zone.Entity.FireInput({ input: "Disable" });
  Zone.Entity.FireInput({ input: "Enable", delay: TouchRefreshDelay });
}
function CountZones(Team) {
  return GZones.filter((Zone) => {
    return Zone.Team === Team && Zone.Entity.IsValid();
  }).length;
}
function GetToucherSlot(Activator) {
  return IsPlayerPawn(Activator) ? GetPlayerSlot(Activator) : INDEX_NONE;
}
function FindEnemyZone(Pawn, Slot) {
  const Team = Pawn.GetTeamNumber();
  return GZones.find((Zone) => {
    return Zone.Team !== Team && Zone.Touching.has(Slot) && Zone.Entity.IsValid();
  });
}
function GetVisitor(Slot) {
  let Visitor = GVisitors.get(Slot);
  if (!Visitor) {
    Visitor = { History: [], BlockedTicks: 0 };
    GVisitors.set(Slot, Visitor);
  }
  return Visitor;
}
function Block(Pawn, Visitor, Zone) {
  Visitor.BlockedTicks++;
  if (Visitor.BlockedTicks % StuckResyncTicks === 0) {
    RefreshTouches(Zone);
  }
  if (Visitor.BlockedTicks > 1) {
    Visitor.History.pop();
  }
  const SafeSpot = Visitor.History[Visitor.History.length - 1];
  if (SafeSpot) {
    const Inward = VectorMath.GetSafeNormal(VectorMath.Subtract(Pawn.GetAbsOrigin(), SafeSpot));
    const Velocity = Pawn.GetAbsVelocity();
    const bMovingIn = VectorMath.Dot(Velocity, Inward) > 0;
    Pawn.Teleport({ position: SafeSpot, velocity: bMovingIn ? VectorMath.ProjectOnPlane(Velocity, Inward) : Velocity });
    return;
  }
  const Offset = VectorMath.Subtract(Pawn.GetAbsOrigin(), Zone.Entity.GetAbsOrigin());
  const Away = VectorMath.GetSafeNormal({ x: Offset.x, y: Offset.y, z: 0 });
  Pawn.Teleport({ velocity: VectorMath.Scale(Away, SpawnZoneSettings.PushOutSpeed) });
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
  // A player hurt by another player (never themselves)
  OnPlayerDamage(VictimSlot, AttackerSlot, Damage) {
  }
  // AttackerSlot is INDEX_NONE when nobody else got the kill
  OnPlayerKill(VictimSlot, AttackerSlot) {
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

// src/gamemodes/bm_freeforall.ts
var GScores = /* @__PURE__ */ new Map();
var FreeForAllMode = class extends GameMode {
  DisplayName = "Free for all";
  CommandName = "ffa";
  IsMapSetUp() {
    return true;
  }
  GetMatchCommands() {
    const Commands = [
      "mp_teammates_are_enemies 1",
      "mp_solid_teammates 1",
      "mp_friendlyfire 1",
      "mp_ignore_round_win_conditions 1",
      "mp_respawn_on_death_t 1",
      "mp_respawn_on_death_ct 1",
      "mp_roundtime 60",
      "mp_roundtime_defuse 60",
      "mp_roundtime_hostage 60"
    ];
    if (bDebug) {
      Commands.push("bot_stop 1");
    }
    return Commands;
  }
  OnDeactivated() {
    ShowLeaderboard(void 0);
  }
  OnRoundStart() {
    GScores.clear();
  }
  OnPlayerSpawn(Pawn, Slot) {
    ResetBotMode(Slot);
  }
  OnPlayerDamage(VictimSlot, AttackerSlot, Damage) {
    GetScore(AttackerSlot).Damage += Damage;
  }
  OnPlayerKill(VictimSlot, AttackerSlot) {
    if (AttackerSlot !== INDEX_NONE) {
      GetScore(AttackerSlot).Kills++;
    }
  }
  OnPlayerLeave(Slot) {
    ForgetBot(Slot);
    GScores.delete(Slot);
  }
  Tick(Now, DeltaTime) {
    TickBots(Now);
    const Rows = BuildLeaderboard();
    ShowLeaderboard(Rows);
    ForEachPlayer((Controller, Slot) => {
      if (!Controller.IsBot()) {
        ShowLeaderboardYou(Slot, Rows);
      }
    });
  }
};
function GetScore(Slot) {
  return GetOrCreate(GScores, Slot, () => {
    return { Kills: 0, Damage: 0 };
  });
}
function BuildLeaderboard() {
  const Rows = [];
  ForEachPlayer((Controller, Slot) => {
    const Team = Controller.GetTeamNumber();
    if (Team !== 2 /* Terrorist */ && Team !== 3 /* CounterTerrorist */) {
      return;
    }
    const Score = GScores.get(Slot);
    Rows.push({ Slot, Name: Controller.GetPlayerName(), Kills: Score ? Score.Kills : 0, Damage: Score ? Math.round(Score.Damage) : 0 });
  });
  return Rows.sort((A, B) => {
    return B.Kills - A.Kills || B.Damage - A.Damage || A.Slot - B.Slot;
  });
}

// src/gamemodes/bm_payload.ts
import { Instance as Instance14, Console as Console15, GameRules as GameRules2, Entities as Entities6, CSRoundEndReason, CSDamageFlags as CSDamageFlags3 } from "cs_script/point_script";
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
  TurnBlendDistance: 48,
  BuyTime: 3,
  HumiliationTime: 5
};
var AttackingTeam = 2 /* Terrorist */;
var DefendingTeam = 3 /* CounterTerrorist */;
var PathPointClasses = ["info_target", "path_track"];
var CartClasses = ["prop_dynamic", "prop_dynamic_override"];
var RescanInterval3 = 1;
var TrackDebugColor = { r: 240, g: 200, b: 60 };
var CheckpointDebugColor = { r: 120, g: 230, b: 120 };
var GTrack = void 0;
var GCart = void 0;
var GDistance = 0;
var GSavedDistance = 0;
var GCheckpointsReached = 0;
var GLastAttendedTime = 0;
var GbRoundTimerSet = false;
var GbRoundOver = false;
var GbDelivered = false;
var GWinner = void 0;
var GRoundEndTime = 0;
var GNextScanTime2 = 0;
var GStatus = void 0;
var GLastScanReport2 = "";
var GHealAccumulators = /* @__PURE__ */ new Map();
var PayloadMode = class extends GameMode {
  DisplayName = "Payload";
  CommandName = "payload";
  IsMapSetUp() {
    ScanPayload();
    return IsPayloadReady();
  }
  GetMatchCommands() {
    const Minutes = PayloadSettings.RoundTime / 60;
    return [
      "mp_teammates_are_enemies 0",
      "mp_friendlyfire 0",
      "mp_ignore_round_win_conditions 1",
      "mp_warmup_pausetimer 0",
      "mp_respawn_on_death_t 1",
      "mp_respawn_on_death_ct 1",
      `mp_buytime ${PayloadSettings.BuyTime}`,
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
    for (const Controller of Instance14.GetAllPlayerControllers()) {
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
    GWinner = void 0;
    GHealAccumulators.clear();
    GStatus = void 0;
    PlaceCart(true);
  }
  OnRoundEnd() {
    GbRoundOver = true;
    GWinner = void 0;
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
  if (!IsPayloadReady() && Now >= GNextScanTime2) {
    GNextScanTime2 = Now + RescanInterval3;
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
  if (GWinner !== void 0) {
    TickHumiliation(GWinner, Now);
  }
  if (GbRoundOver || GameRules2.IsWarmupPeriod() || GameRules2.IsFreezePeriod()) {
    GStatus = MakeStatus(Track, 0, false, false, false, Now);
    return;
  }
  if (!GbRoundTimerSet) {
    GbRoundTimerSet = true;
    GLastAttendedTime = Now;
    GameRules2.SetRoundRemainingTime(PayloadSettings.RoundTime);
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
  const bTimeUp = GameRules2.GetRoundRemainingTime() <= 0;
  if (GDistance >= Track.Length) {
    GbDelivered = true;
    WinRound(AttackingTeam, Now);
  } else if (bTimeUp && Crowd.Attackers.length === 0) {
    WinRound(DefendingTeam, Now);
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
    GameRules2.SetRoundRemainingTime(Math.max(0, GameRules2.GetRoundRemainingTime()) + PayloadSettings.CheckpointBonusTime);
    Console15.Log(`${LogPrefix} payload checkpoint ${GCheckpointsReached} / ${Track.Checkpoints.length} reached. adding ${PayloadSettings.CheckpointBonusTime} seconds to match timer`);
  }
}
function WinRound(Winner, Now) {
  if (GbRoundOver) {
    return;
  }
  GbRoundOver = true;
  GWinner = Winner;
  GRoundEndTime = Now + PayloadSettings.HumiliationTime;
  const Loser = GetOtherTeam(Winner);
  Console15.ServerCommand(`mp_respawn_on_death_${Loser === 2 /* Terrorist */ ? "t" : "ct"} 0`);
  KillTeam(Loser);
  Console15.Log(`${LogPrefix} payload round won. ${Winner === AttackingTeam ? "Ts delivered the cart" : "CTs held"}, round ends in ${PayloadSettings.HumiliationTime}s`);
}
function TickHumiliation(Winner, Now) {
  KillTeam(GetOtherTeam(Winner));
  if (Now < GRoundEndTime) {
    return;
  }
  GWinner = void 0;
  GameRules2.AddTeamScore(Winner, 1);
  GameRules2.TerminateRound(Winner === 2 /* Terrorist */ ? CSRoundEndReason.TERRORISTS_WIN : CSRoundEndReason.CTS_WIN);
}
function KillTeam(Team) {
  ForEachLivePawn((Pawn) => {
    if (Pawn.GetTeamNumber() === Team) {
      Pawn.TakeDamage({ damage: Pawn.GetHealth() + 1e3, damageFlags: CSDamageFlags3.FORCE_DEATH | CSDamageFlags3.IGNORE_ARMOR });
    }
  });
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
  const Report = IsPayloadReady() && GTrack ? `payload on: ${GTrack.Points.length} track points, ${Math.round(GTrack.Length)}u long, ${GTrack.Checkpoints.length} checkpoints` : CartEntity || Points.length > 0 ? `payload off: found ${CartEntity ? "a cart" : "no cart"} ("${PayloadSettings.CartName}") and ${Points.length} track points ("${PayloadSettings.PathPrefix}1" ...). It needs a cart and at least 2 points.` : "";
  if (Report !== "" && Report !== GLastScanReport2) {
    Console15.Log(`${LogPrefix} ${Report}`);
  }
  GLastScanReport2 = Report;
}
function FindCartEntity() {
  const Named = Entities6.FindByName(PayloadSettings.CartName).find((Ent) => {
    return Ent.IsValid();
  });
  if (Named) {
    return Named;
  }
  for (const ClassName of CartClasses) {
    for (const Ent of Entities6.FindByClass(ClassName)) {
      if (Ent.IsValid() && Ent.GetEntityName().includes(PayloadSettings.CartName)) {
        return Ent;
      }
    }
  }
  return void 0;
}
function FindPathPoints() {
  const Candidates = new Set(Entities6.FindByName(`${PayloadSettings.PathPrefix}*`));
  for (const ClassName of PathPointClasses) {
    for (const Ent of Entities6.FindByClass(ClassName)) {
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
  const Here = FindNearestTrackDistance(Track, CartEntity.GetAbsOrigin());
  const TrackRotation = RotationMath.FromRotator(VectorMath.GetRotation(GetTrackDirection(Track, Here)));
  const PlacedRotation = RotationMath.FromRotator(CartEntity.GetAbsAngles());
  return { Entity: CartEntity, LocalRotation: RotationMath.Multiply(RotationMath.Inverse(TrackRotation), PlacedRotation) };
}
function FindNearestTrackDistance(Track, Position) {
  let Best = 0;
  let BestGap = Infinity;
  for (let Index = 0; Index < Track.Directions.length; Index++) {
    const Start = Track.Points[Index];
    const End = Track.Points[Index + 1];
    if (!Start || !End) {
      continue;
    }
    const Nearest = VectorMath.ClosestPointOnSegment(Position, Start, End);
    const Gap = VectorMath.Size(VectorMath.Subtract(Position, Nearest));
    if (Gap < BestGap) {
      BestGap = Gap;
      Best = (Track.Distances[Index] ?? 0) + VectorMath.Size(VectorMath.Subtract(Nearest, Start));
    }
  }
  return Best;
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
      Instance14.DebugLine({ start: From, end: To, duration: TickInterval * 2, color: TrackDebugColor });
    }
  }
  for (const CheckpointDistance of Track.Checkpoints) {
    Instance14.DebugSphere({ center: GetTrackPosition(Track, CheckpointDistance), radius: 16, duration: TickInterval * 2, color: CheckpointDebugColor });
  }
}

// src/gamemodes/bm_teamdeathmatch.ts
import { Instance as Instance15, Console as Console16, GameRules as GameRules3, CSRoundEndReason as CSRoundEndReason2 } from "cs_script/point_script";
var TeamDeathmatchSettings = {
  KillsToWin: 100
};
var GScores2 = /* @__PURE__ */ new Map();
var GTeamKills = /* @__PURE__ */ new Map();
var GWinner2 = void 0;
var GbRoundEnded = false;
var TeamDeathmatchMode = class extends GameMode {
  DisplayName = "Team deathmatch";
  CommandName = "tdm";
  IsMapSetUp() {
    return true;
  }
  GetMatchCommands() {
    return [
      "mp_teammates_are_enemies 0",
      "mp_friendlyfire 0",
      "mp_ignore_round_win_conditions 1",
      "mp_respawn_on_death_t 1",
      "mp_respawn_on_death_ct 1",
      "mp_use_respawn_waves 0",
      "mp_deathcam_skippable 1",
      "mp_roundtime 60",
      "mp_roundtime_defuse 60",
      "mp_roundtime_hostage 60",
      "bot_stop 0"
    ];
  }
  OnDeactivated() {
    ShowTeamLeaderboard(void 0);
  }
  OnRoundStart() {
    GScores2.clear();
    GTeamKills.clear();
    GWinner2 = void 0;
    GbRoundEnded = false;
  }
  OnPlayerDamage(VictimSlot, AttackerSlot, Damage) {
    if (IsCounting()) {
      GetScore2(AttackerSlot).Damage += Damage;
    }
  }
  OnPlayerKill(VictimSlot, AttackerSlot) {
    if (AttackerSlot === INDEX_NONE || !IsCounting()) {
      return;
    }
    const Team = Instance15.GetPlayerController(AttackerSlot)?.GetTeamNumber();
    if (Team !== 2 /* Terrorist */ && Team !== 3 /* CounterTerrorist */) {
      return;
    }
    GetScore2(AttackerSlot).Kills++;
    const TeamKills = (GTeamKills.get(Team) ?? 0) + 1;
    GTeamKills.set(Team, TeamKills);
    if (TeamKills >= TeamDeathmatchSettings.KillsToWin) {
      GWinner2 = Team;
    }
  }
  OnPlayerLeave(Slot) {
    GScores2.delete(Slot);
  }
  Tick(Now, DeltaTime) {
    if (GWinner2 !== void 0 && !GbRoundEnded) {
      EndRound(GWinner2);
    }
    const Board = BuildLeaderboard2();
    ShowTeamLeaderboard(Board);
    ForEachPlayer((Controller, Slot) => {
      if (!Controller.IsBot()) {
        ShowTeamLeaderboardYou(Slot, Board);
      }
    });
  }
};
function IsCounting() {
  return GWinner2 === void 0 && !GameRules3.IsWarmupPeriod();
}
function EndRound(Winner) {
  GbRoundEnded = true;
  const bTerrorists = Winner === 2 /* Terrorist */;
  Console16.Log(`${LogPrefix} ${bTerrorists ? "terrorists" : "counter-terrorists"} reached ${TeamDeathmatchSettings.KillsToWin} kills and win`);
  GameRules3.AddTeamScore(Winner, 1);
  GameRules3.TerminateRound(bTerrorists ? CSRoundEndReason2.TERRORISTS_WIN : CSRoundEndReason2.CTS_WIN);
}
function GetScore2(Slot) {
  return GetOrCreate(GScores2, Slot, () => {
    return { Kills: 0, Damage: 0 };
  });
}
function BuildLeaderboard2() {
  const Terrorists = [];
  const CounterTerrorists = [];
  ForEachPlayer((Controller, Slot) => {
    const Team = Controller.GetTeamNumber();
    const Rows = Team === 2 /* Terrorist */ ? Terrorists : Team === 3 /* CounterTerrorist */ ? CounterTerrorists : void 0;
    const Score = GScores2.get(Slot);
    Rows?.push({ Slot, Name: Controller.GetPlayerName(), Kills: Score ? Score.Kills : 0, Damage: Score ? Math.round(Score.Damage) : 0 });
  });
  return {
    KillsToWin: TeamDeathmatchSettings.KillsToWin,
    TerroristKills: GTeamKills.get(2 /* Terrorist */) ?? 0,
    CounterTerroristKills: GTeamKills.get(3 /* CounterTerrorist */) ?? 0,
    Terrorists: Terrorists.sort(CompareRows),
    CounterTerrorists: CounterTerrorists.sort(CompareRows)
  };
}
function CompareRows(A, B) {
  return B.Kills - A.Kills || B.Damage - A.Damage || A.Slot - B.Slot;
}

// src/bm_main.ts
var MainSettings = {
  MaxDeltaTime: 0.1,
  AirshotMinHeight: 96,
  TargetIdRange: 3e3,
  LoadoutDelay: 0.1,
  ClassMenuDelay: 0.5,
  MapModePrefix: "bm_gm_",
  DebugBotQuota: 8
};
var DefaultMode = new FreeForAllMode();
var GameModes = [new PayloadMode(), DefaultMode, new TeamDeathmatchMode()];
var GActiveMode = DefaultMode;
var GChosenMode = void 0;
var GClassBySlot = /* @__PURE__ */ new Map();
var GPendingClassBySlot = /* @__PURE__ */ new Map();
var GLastThinkTime = 0;
function Tick() {
  const Now = Instance16.GetGameTime();
  Instance16.SetNextThink(Now + TickInterval);
  const DeltaTime = Math.min(MainSettings.MaxDeltaTime, Math.max(0, Now - GLastThinkTime)) || TickInterval;
  GLastThinkTime = Now;
  try {
    TickMatch(Now);
    TickTimers(Now);
    for (const Definition of Object.values(ClassDefinitions)) {
      Definition.TickWorld(Now, DeltaTime);
    }
    ForEachLivePawn((Pawn, Slot) => {
      const PlayerClass3 = GClassBySlot.get(Slot);
      if (PlayerClass3 !== void 0) {
        const Definition = ClassDefinitions[PlayerClass3];
        TickBotCombat(Pawn, Slot, Now, Definition);
        EmptyRealGuns(Pawn);
        const Shot = TickLauncher(Pawn, Slot, Now);
        if (Shot) {
          Definition.OnLauncherFired(Pawn, Slot, Now, Shot);
        }
        Definition.TickPlayer(Pawn, Slot, Now, DeltaTime);
      }
    });
    for (const Definition of Object.values(ClassDefinitions)) {
      Definition.TickWorldLate(Now, DeltaTime);
    }
    TickBuildings(Now, DeltaTime);
    GActiveMode.Tick(Now, DeltaTime);
    TickHealthKits(Now);
    TickSpawnZones(Now);
    TickSpawnClassSwaps();
    TickClassMenuKey();
    TickPlayerHud();
    TickNoBuying();
    TickBotClasses();
  } catch (Exception) {
    Console17.Log(`${LogPrefix} error: ${String(Exception)}`);
  }
}
function BeginPlay() {
  PrecacheSounds();
  SelectGameMode();
  ApplyMatchSettings();
  Instance16.OnPlayerChat(HandlePlayerChat);
  Instance16.OnPlayerReset(HandlePlayerReset);
  Instance16.OnPlayerKill(HandlePlayerKill);
  Instance16.OnPlayerDisconnect(HandlePlayerDisconnect);
  Instance16.OnRoundStart(HandleRoundStart);
  Instance16.OnRoundEnd(HandleRoundEnd);
  Instance16.OnGunFire(HandleGunFire);
  Instance16.OnKnifeAttack(HandleKnifeAttack);
  Instance16.OnWeaponPickup(HandleWeaponPickup);
  Instance16.OnWeaponDrop(HandleWeaponDrop);
  Instance16.OnPlayerDamage(HandlePlayerDamage);
  Instance16.OnModifyPlayerDamage(HandleModifyPlayerDamage);
  Instance16.OnCustomHudClicked(HandleCustomHudClicked);
  Instance16.SetThink(Tick);
  Instance16.SetNextThink(Instance16.GetGameTime());
  Console17.Log(`${LogPrefix} loaded${bDebug ? " DEBUG mode!" : ""}`);
}
BeginPlay();
function HandlePlayerChat(Event) {
  const Player = Event.player;
  const Text = Event.text.trim().toLowerCase();
  if (!Player || !Text.startsWith(ChatCommandPrefix)) {
    return;
  }
  const Command = Text.substring(ChatCommandPrefix.length);
  const PlayerClass3 = Object.values(EPlayerClass).find((Candidate) => {
    return Candidate === Command;
  });
  const Mode = GameModes.find((Candidate) => {
    return Candidate.CommandName === Command;
  });
  if (Command === "class") {
    OpenClassMenu(Player.GetPlayerSlot());
  } else if (Command === "start") {
    EndWarmupNow(Player);
  } else if (Command === "spawntest" && bDebug) {
    const Pawn = Player.GetPlayerPawn();
    if (Pawn) {
      RunSpawnTest(Pawn);
    }
  } else if (PlayerClass3 !== void 0) {
    RequestPlayerClass(Player, PlayerClass3);
  } else if (Mode !== void 0) {
    ChooseGameMode(Player, Mode);
  } else {
    Console17.Log(`${LogPrefix} ${Player.GetPlayerName()} typed unknown command "${ChatCommandPrefix}${Command}"`);
  }
}
function HandlePlayerReset(Event) {
  const Pawn = Event.player;
  const Slot = GetPlayerSlot(Pawn);
  if (Slot === INDEX_NONE) {
    return;
  }
  ClearPlayer(Slot);
  ShowBody(Pawn);
  ForgetSpawnZoneHistory(Slot);
  RefreshSpawnZoneTouches();
  GActiveMode.OnPlayerSpawn(Pawn, Slot);
  QueueRandomBotClass(Pawn, Slot);
  const bHadClass = GClassBySlot.has(Slot);
  ApplyPendingClass(Slot);
  RefreshClassUi(Pawn, Slot);
  const PlayerClass3 = GClassBySlot.get(Slot);
  SetTimer(MainSettings.LoadoutDelay, () => {
    if (!Pawn.IsValid() || !Pawn.IsAlive() || GClassBySlot.get(Slot) !== PlayerClass3) {
      return;
    }
    if (PlayerClass3 === void 0) {
      if (bHadClass) {
        RestoreDefaultBody(Pawn);
      }
      GiveNoClassLoadout(Pawn);
    } else {
      GiveLoadout(Pawn, PlayerClass3);
    }
  });
}
function HandlePlayerKill(Event) {
  const Slot = GetPlayerSlot(Event.player);
  if (Slot !== INDEX_NONE) {
    const PlayerClass3 = GClassBySlot.get(Slot);
    if (PlayerClass3 !== void 0 && ClassDefinitions[PlayerClass3].Settings.Model !== "") {
      SpawnGibs(Event.player);
      HideBody(Event.player);
    }
    const KillerSlot = GetPlayerSlot(Event.attacker);
    GActiveMode.OnPlayerKill(Slot, KillerSlot !== Slot ? KillerSlot : INDEX_NONE);
    ClearPlayer(Slot);
    RemoveBuildings(Slot);
    ForgetSpawnZonePlayer(Slot);
  }
}
function HandlePlayerDisconnect(Event) {
  ClearPlayer(Event.playerSlot);
  RemoveBuildings(Event.playerSlot);
  ForgetSpawnZonePlayer(Event.playerSlot);
  ForgetBotCombat(Event.playerSlot);
  for (const Mode of GameModes) {
    Mode.OnPlayerLeave(Event.playerSlot);
  }
  ResetDamageNumbers(Event.playerSlot);
  ResetClassUi(Event.playerSlot);
  ForgetPlayerModel(Event.playerSlot);
  GClassBySlot.delete(Event.playerSlot);
  GPendingClassBySlot.delete(Event.playerSlot);
}
function HandleRoundStart() {
  for (const Definition of Object.values(ClassDefinitions)) {
    Definition.OnRoundStart();
  }
  ClearDecals();
  ClearBuildings();
  ResetHealthKits();
  ResetSpawnZones();
  SelectGameMode();
  GActiveMode.OnRoundStart();
  ApplyMatchSettings();
  Console17.Log(`${LogPrefix} round has started [${GActiveMode.DisplayName}]`);
}
function HandleRoundEnd() {
  GActiveMode.OnRoundEnd();
}
function HandleGunFire(Event) {
  const Weapon = Event.weapon;
  const Pawn = Weapon.GetOwner();
  const Slot = GetPlayerSlot(Pawn);
  const PlayerClass3 = GClassBySlot.get(Slot);
  if (!Pawn || PlayerClass3 === void 0) {
    return;
  }
  const Definition = ClassDefinitions[PlayerClass3];
  if (IsWeapon(Weapon, Definition.Settings.Primary) && !Definition.Settings.PrimaryLauncher) {
    Definition.OnPrimaryFire(Pawn, Slot, Instance16.GetGameTime(), 0);
  } else if (IsWeapon(Weapon, Definition.Settings.Secondary) && !Definition.Settings.SecondaryLauncher) {
    Definition.OnSecondaryFire(Pawn, Slot, Instance16.GetGameTime(), 0);
  }
}
function HandleKnifeAttack(Event) {
  const Pawn = Event.weapon.GetOwner();
  const Slot = GetPlayerSlot(Pawn);
  const PlayerClass3 = GClassBySlot.get(Slot);
  if (!Pawn || PlayerClass3 === void 0) {
    return;
  }
  const RepairPerHit = ClassDefinitions[PlayerClass3].Settings.RepairPerHit;
  if (RepairPerHit !== void 0) {
    RepairBuildingInReach(Pawn, Slot, RepairPerHit, Instance16.GetGameTime());
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
    RemoveDroppedWeapon(Weapon, Dropper);
  });
}
function HandlePlayerDamage(Event) {
  const AttackerSlot = GetPlayerSlot(Event.attacker);
  if (AttackerSlot === INDEX_NONE || Event.attacker === Event.player) {
    return;
  }
  ShowDamageNumber(AttackerSlot, Event.damage);
  GActiveMode.OnPlayerDamage(GetPlayerSlot(Event.player), AttackerSlot, Event.damage);
  if (GetHeightAboveGround(Event.player, MainSettings.AirshotMinHeight) >= MainSettings.AirshotMinHeight) {
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
  if ((Event.damageFlags & CSDamageFlags4.FORCE_DEATH) !== 0) {
    return;
  }
  for (const Definition of Object.values(ClassDefinitions)) {
    const Result = Definition.ModifyAnyDamage(Event);
    if (Result) {
      return Result;
    }
  }
  if ((Event.damageTypes & CSDamageTypes4.FALL) !== 0 && GClassBySlot.has(GetPlayerSlot(Event.player))) {
    return { abort: true };
  }
  const AttackerSlot = GetPlayerSlot(Event.attacker);
  const AttackerClass = GClassBySlot.get(AttackerSlot);
  if (AttackerClass === void 0) {
    return;
  }
  return ClassDefinitions[AttackerClass].ModifyOutgoingDamage(Event);
}
function SelectGameMode() {
  const MapMode = GameModes.find((Candidate) => {
    return Entities7.FindByName(`${MainSettings.MapModePrefix}${Candidate.CommandName}`).length > 0;
  });
  const Mode = [GChosenMode, MapMode].find((Candidate) => {
    return Candidate !== void 0 && Candidate.IsMapSetUp();
  }) ?? GameModes.find((Candidate) => {
    return Candidate.IsMapSetUp();
  }) ?? DefaultMode;
  if (Mode !== GActiveMode) {
    GActiveMode.OnDeactivated();
    GActiveMode = Mode;
    Mode.OnActivated();
    Console17.Log(`${LogPrefix} activated ${Mode.DisplayName}`);
  }
}
function ChooseGameMode(Player, Mode) {
  if (!Mode.IsMapSetUp()) {
    Console17.Log(`${LogPrefix} ${Player.GetPlayerName()} picked ${Mode.DisplayName}, but this map isn't set up for it`);
    return;
  }
  GChosenMode = Mode;
  Console17.Log(`${LogPrefix} ${Player.GetPlayerName()} picked ${Mode.DisplayName}, restarting`);
  Console17.ServerCommand("mp_restartgame 1");
}
function ApplyMatchSettings() {
  const Commands = [];
  Commands.push("sv_infinite_ammo 0");
  Commands.push("mp_solid_teammates 0");
  if (bDebug) {
    Commands.push("mp_do_warmup_period 0", "mp_warmuptime 0", "mp_freezetime 0");
    Commands.push("bot_quota_mode fill", `bot_quota ${MainSettings.DebugBotQuota}`, "bot_join_team any");
  }
  Commands.push(...GActiveMode.GetMatchCommands());
  for (const Command of Commands) {
    Console17.ServerCommand(Command);
  }
}
function EndWarmupNow(Player) {
  if (!GameRules4.IsWarmupPeriod()) {
    Console17.Log(`${LogPrefix} ${Player.GetPlayerName()} typed ${ChatCommandPrefix}start, but warmup is already over`);
    return;
  }
  Console17.Log(`${LogPrefix} ${Player.GetPlayerName()} ended warmup`);
  GameRules4.EndWarmup();
}
function TickMatch(Now) {
  if (bDebug && GameRules4.IsWarmupPeriod()) {
    Console17.ServerCommand("mp_warmup_end");
  }
}
function RequestPlayerClass(Player, PlayerClass3) {
  const Slot = Player.GetPlayerSlot();
  const CurrentClass = GClassBySlot.get(Slot) ?? "none" /* None */;
  const Pawn = Player.GetPlayerPawn();
  const bAlive = Pawn !== void 0 && Pawn.IsValid() && Pawn.IsAlive();
  const bInSpawn = bAlive && Pawn !== void 0 && IsInFriendlySpawnZone(Pawn, Slot);
  if (PlayerClass3 !== "none" /* None */ && Pawn && Pawn.IsValid()) {
    ClassDefinitions[PlayerClass3].PlayPickFx(Pawn);
  }
  if (!bAlive || CurrentClass === "none" /* None */ || (bInSpawn || bDebug) && PlayerClass3 !== CurrentClass) {
    GPendingClassBySlot.delete(Slot);
    SetPlayerClass(Player, PlayerClass3);
    return;
  }
  if (PlayerClass3 === CurrentClass) {
    GPendingClassBySlot.delete(Slot);
  } else {
    GPendingClassBySlot.set(Slot, PlayerClass3);
  }
  ShowClassIndicator(Slot, CurrentClass, Pawn?.GetTeamNumber() === 2 /* Terrorist */);
  Console17.Log(`${LogPrefix} ${Player.GetPlayerName()} requested class ${PlayerClass3}`);
}
function TickSpawnClassSwaps() {
  ForEachLivePawn((Pawn, Slot) => {
    const NextClass = GPendingClassBySlot.get(Slot);
    const Controller = Pawn.GetPlayerController();
    if (NextClass === void 0 || !Controller || !IsInFriendlySpawnZone(Pawn, Slot)) {
      return;
    }
    GPendingClassBySlot.delete(Slot);
    SetPlayerClass(Controller, NextClass);
  });
}
function ApplyPendingClass(Slot) {
  const NextClass = GPendingClassBySlot.get(Slot);
  if (NextClass === void 0) {
    return;
  }
  GPendingClassBySlot.delete(Slot);
  if (NextClass !== (GClassBySlot.get(Slot) ?? "none" /* None */)) {
    RemoveBuildings(Slot);
  }
  if (NextClass === "none" /* None */) {
    GClassBySlot.delete(Slot);
  } else {
    GClassBySlot.set(Slot, NextClass);
  }
}
function SetPlayerClass(Player, PlayerClass3) {
  const Slot = Player.GetPlayerSlot();
  ClearPlayer(Slot);
  if (PlayerClass3 !== (GClassBySlot.get(Slot) ?? "none" /* None */)) {
    RemoveBuildings(Slot);
  }
  const Pawn = Player.GetPlayerPawn();
  if (PlayerClass3 === "none" /* None */) {
    GClassBySlot.delete(Slot);
    if (Pawn && Pawn.IsAlive()) {
      RestoreDefaultBody(Pawn);
      GiveNoClassLoadout(Pawn);
    }
  } else {
    GClassBySlot.set(Slot, PlayerClass3);
    if (Pawn && Pawn.IsAlive()) {
      GiveLoadout(Pawn, PlayerClass3);
    }
  }
  ShowClassIndicator(Slot, PlayerClass3, Pawn?.GetTeamNumber() === 2 /* Terrorist */);
  const ClassLabel = PlayerClass3 === "none" /* None */ ? "normal" : PlayerClass3;
  Console17.Log(`${LogPrefix} ${Player.GetPlayerName()} set class to ${ClassLabel}`);
}
function AssignRandomBotClass(Pawn, Slot) {
  const Controller = Pawn.GetPlayerController();
  if (!Controller || !Controller.IsBot() || GClassBySlot.has(Slot) || GPendingClassBySlot.has(Slot)) {
    return false;
  }
  const PlayerClass3 = PickRandomClass();
  GClassBySlot.set(Slot, PlayerClass3);
  return true;
}
function QueueRandomBotClass(Pawn, Slot) {
  const Controller = Pawn.GetPlayerController();
  if (Controller && Controller.IsBot() && !GPendingClassBySlot.has(Slot)) {
    GPendingClassBySlot.set(Slot, PickRandomClass());
  }
}
function TickBotClasses() {
  ForEachLivePawn((Pawn, Slot) => {
    const PlayerClass3 = AssignRandomBotClass(Pawn, Slot) ? GClassBySlot.get(Slot) : void 0;
    if (PlayerClass3 !== void 0) {
      GiveLoadout(Pawn, PlayerClass3);
    }
  });
}
function RefreshClassUi(Pawn, Slot) {
  const Controller = Pawn.GetPlayerController();
  if (!Controller || Controller.IsBot()) {
    return;
  }
  const PlayerClass3 = GClassBySlot.get(Slot) ?? "none" /* None */;
  ShowClassIndicator(Slot, PlayerClass3, Pawn.GetTeamNumber() === 2 /* Terrorist */);
  SetTimer(MainSettings.ClassMenuDelay, () => {
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
  ShowBuildings(Slot, []);
  ShowBuildHints(Slot, void 0);
  ShowTargetId(Slot, void 0);
}
function TickPlayerHud() {
  ForEachLivePawn((Pawn, Slot) => {
    const Controller = Pawn.GetPlayerController();
    if (Controller && !Controller.IsBot()) {
      const PlayerClass3 = GClassBySlot.get(Slot);
      ShowHealth(Slot, Pawn);
      ShowAmmo(Slot, GetLauncherAmmo(Pawn, Slot));
      ShowCounter(Slot, PlayerClass3 !== void 0 ? ClassDefinitions[PlayerClass3].GetHudCounter(Slot) : void 0);
      ShowBuildings(Slot, GetBuildingHudRows(Slot, Instance16.GetGameTime()));
      const BuildKeys = PlayerClass3 !== void 0 ? ClassDefinitions[PlayerClass3].GetBuildKeys(Pawn) : void 0;
      ShowBuildHints(Slot, BuildKeys ? GetBuildHints(Slot, BuildKeys, Instance16.GetGameTime()) : void 0);
      ShowTargetId(Slot, FindTargetId(Pawn, Slot));
      GActiveMode.TickPlayerHud(Pawn, Slot);
    }
  });
}
function FindTargetId(Pawn, Slot) {
  const ViewerClass = GClassBySlot.get(Slot);
  const HealTarget = ViewerClass !== void 0 ? ClassDefinitions[ViewerClass].GetHealTarget(Slot) : void 0;
  if (HealTarget) {
    return GetPawnTargetId(HealTarget, Pawn);
  }
  const Eye = Pawn.GetEyePosition();
  const End = VectorMath.Add(Eye, VectorMath.Scale(VectorMath.GetForwardVector(Pawn.GetEyeAngles()), MainSettings.TargetIdRange));
  const Trace = Instance16.TraceLine({ start: Eye, end: End, ignoreEntity: Pawn });
  const Turret = FindFriendlyTurret(Pawn, Eye, End, Trace);
  return Turret ? GetTurretTargetId(Turret) : GetPawnTargetId(Trace.hitEntity, Pawn);
}
function GetPawnTargetId(Target, Viewer) {
  if (!IsPlayerPawn(Target) || !Target.IsAlive() || !IsTeammate(Target, Viewer)) {
    return void 0;
  }
  const TargetClass = GClassBySlot.get(GetPlayerSlot(Target));
  const Name = TargetClass !== void 0 ? `${GetPawnName(Target)} (${ClassDefinitions[TargetClass].Settings.DisplayName})` : GetPawnName(Target);
  const MaxHealth = Target.GetMaxHealth();
  return { Name, Health: Target.GetHealth(), MaxHealth, MaxOverheal: Math.floor(MaxHealth * MedicSettings.OverhealMult), bTerrorist: Target.GetTeamNumber() === 2 /* Terrorist */ };
}
function GetTurretTargetId(Turret) {
  const MaxHealth = Turret.Kind.Settings.Health;
  const Name = `${GetPawnName(Turret.Owner)}'s ${Turret.Kind.Settings.DisplayName}`;
  return { Name, Health: Math.max(0, Math.ceil(Turret.Health)), MaxHealth, MaxOverheal: MaxHealth, bTerrorist: Turret.Team === 2 /* Terrorist */ };
}
function FindFriendlyTurret(Viewer, Eye, End, Trace) {
  const IsFriendlyTurret = (Building) => {
    return Building.Kind instanceof TurretKind && !Building.bRemoved && !IsBuildingEnemy(Building, Viewer);
  };
  const Struck = GetTraceBuilding(Trace);
  if (Struck) {
    return IsFriendlyTurret(Struck) ? Struck : void 0;
  }
  const Hit = TraceBuildings(Eye, End, 0, IsFriendlyTurret);
  return Hit && (!Trace.didHit || Hit.Fraction <= Trace.fraction) ? Hit.Building : void 0;
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
  const PlayerClass3 = GClassBySlot.get(Slot) ?? "none" /* None */;
  if (IsWeaponAllowed(PlayerClass3, Weapon)) {
    return;
  }
  Pawn.DestroyWeapon(Weapon);
  SetTimer(0, () => {
    EnsureWeaponInHand(Pawn);
  });
}
function RemoveDroppedWeapon(Weapon, Dropper) {
  if (!Weapon.IsValid() || Weapon.GetOwner()) {
    return;
  }
  const Data = Weapon.GetData();
  const ItemName = Data ? Data.GetName() : Weapon.GetClassName();
  const bGiveBack = Dropper.IsValid() && Dropper.IsAlive() && IsWeaponAllowed(GClassBySlot.get(GetPlayerSlot(Dropper)) ?? "none" /* None */, Weapon);
  Weapon.Remove();
  if (bGiveBack) {
    Dropper.GiveNamedItem(ItemName, true);
  }
}
function EnsureWeaponInHand(Pawn) {
  if (!Pawn.IsValid() || !Pawn.IsAlive()) {
    return;
  }
  const Active = Pawn.GetActiveWeapon();
  if (Active && Active.IsValid()) {
    return;
  }
  for (const GearSlot of [CSGearSlot5.RIFLE, CSGearSlot5.PISTOL, CSGearSlot5.KNIFE]) {
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
