import { Instance, Console, Entities } from "cs_script/point_script";
import type { Entity, CSPlayerPawn, CSPrecache, PointTemplate, TraceResult } from "cs_script/point_script";
import { TickInterval, LogPrefix, VectorMath, UpVector, FindPointTemplate, GetChestPosition, GetPlayerSlot, SetTimer } from "./bm_core";
import type { FVector, FRotator, FColor } from "./bm_core";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

interface FBeamCopy
{
	readonly Entities: Entity[];
	readonly RemoveAt: number;
}

export interface FHeldBeam
{
	readonly TemplateName: string;
	readonly EndMarkerName: string;
	readonly FallbackColor: FColor;
	readonly Entities: Entity[];
	// Above 0, a fresh copy of a one-shot beam is spawned this often instead of moving one long-lived copy
	RefireInterval: number;
	NextRefireTime: number;
	readonly Copies: FBeamCopy[];
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const ScorchTemplateName: string = "scorch_template";
const BloodTemplateName: string = "blood_template";
const MaxDecals: number = 48;
const ScorchSearchDistance: number = 16;
const BloodSplatterDistance: number = 128;
const GibTemplateName: string = "gib_template";
const GibFallbackTemplateName: string = "boom_template";
const GibLifetime: number = 5;
const GibFlingSpeed: number = 450;
const RefiredBeamLifetime: number = 0.15;
const BeamParticleSuffix: string = "_fx";
const BeamFxLingerTime: number = 1;
// Sound files loaded up front, so the first play doesn't stall. Add new ones here
const SoundFiles: readonly string[] = [
	"sounds/bm/shrinker_shrink.vsnd",
	"sounds/bm/shrinker_grow.vsnd",
	"sounds/bm/medic_heal_loop.vsnd",
];
const SoundEntityClass: string = "point_soundevent";
// One point_soundevent, no sound set and not started on spawn; the code picks the sound and starts it
const SoundTemplateName: string = "bm_sound_template";
const SpawnTestClasses: readonly string[] = ["point_soundevent", "info_target", "logic_relay", "info_particle_system", "prop_dynamic", "point_template"];
// One-shot sounds clear up when they finish; this is only a backstop in case one never says so
const OneShotSoundLifetime: number = 30;
const StoppedSoundLifetime: number = 0.5;
// A sound follows its source entity, found by name, so players without one are given this plus their slot
const SoundSourcePrefix: string = "bm_player_";

let GSoundPrecache: CSPrecache | undefined = undefined;
let GbSoundSpawnFailed: boolean = false;

let GDecals: Entity[][] = [];

// Decals //////////////////////////////////////////////////////////////////////////////////////////

export function SpawnScorchMark(Position: FVector): void
{
	const Surface: TraceResult | undefined = FindNearbySurface(Position, ScorchSearchDistance);
	if (Surface)
	{
		SpawnDecal(ScorchTemplateName, Surface.end, Surface.normal);
	}
}

export function SpawnBloodSplatter(ExplosionOrigin: FVector, Victim: CSPlayerPawn): void
{
	const Chest: FVector = GetChestPosition(Victim);
	const Away: FVector = VectorMath.GetSafeNormal(VectorMath.Subtract(Chest, ExplosionOrigin));
	const Behind: TraceResult = Instance.TraceLine(
	{
		start: Chest,
		end: VectorMath.Add(Chest, VectorMath.Scale(Away, BloodSplatterDistance)),
		ignorePlayers: true,
	});
	if (Behind.didHit && !Behind.startedInSolid)
	{
		SpawnDecal(BloodTemplateName, Behind.end, Behind.normal);
		return;
	}

	const Below: TraceResult = Instance.TraceLine(
	{
		start: Chest,
		end: VectorMath.Add(Chest, VectorMath.Scale(UpVector, -BloodSplatterDistance)),
		ignorePlayers: true,
	});
	if (Below.didHit && !Below.startedInSolid)
	{
		SpawnDecal(BloodTemplateName, Below.end, Below.normal);
	}
}

// Gibs ////////////////////////////////////////////////////////////////////////////////////////////

export function SpawnGibs(Victim: CSPlayerPawn): void
{
	const Chest: FVector = GetChestPosition(Victim);
	// From just above, so the splat lands on the floor under them
	SpawnBloodSplatter(VectorMath.Add(Chest, UpVector), Victim);

	const Spawned: Entity[] = SpawnTemporaryTemplate(GibTemplateName, Chest, GibLifetime) ?? SpawnTemporaryTemplate(GibFallbackTemplateName, Chest, GibLifetime) ?? [];
	const Momentum: FVector = Victim.GetAbsVelocity();
	for (const Ent of Spawned)
	{
		if (Ent.IsValid() && Ent.GetClassName().startsWith("prop_physics"))
		{
			const Direction: FVector = VectorMath.GetSafeNormal({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: 0.5 + Math.random() });
			Ent.Teleport({ velocity: VectorMath.Add(Momentum, VectorMath.Scale(Direction, GibFlingSpeed)) });
		}
	}
}

// Effects /////////////////////////////////////////////////////////////////////////////////////////

export function SpawnTemporaryTemplate(TemplateName: string, Position: FVector, Lifetime: number): Entity[] | undefined
{
	const Template: PointTemplate | undefined = FindPointTemplate(TemplateName);
	if (!Template)
	{
		return undefined;
	}
	const Spawned: Entity[] | undefined = Template.ForceSpawn(Position);
	if (Spawned && Spawned.length > 0)
	{
		SetTimer(Lifetime, (): void =>
		{
			RemoveEntities(Spawned);
		});
	}
	return Spawned;
}

// Sounds //////////////////////////////////////////////////////////////////////////////////////////

// Plays a sound event (a name from soundevents_addon.vsndevts) on a player. It follows them as they move.
export function PlaySoundOn(SoundEvent: string | undefined, Pawn: CSPlayerPawn): void
{
	const Spawned: Entity[] = SpawnSoundOn(SoundEvent, Pawn);
	if (Spawned.length === 0)
	{
		return;
	}
	const Remove = (): void =>
	{
		RemoveEntities(Spawned);
	};
	for (const Ent of Spawned)
	{
		Entities.ConnectOutput({ target: Ent, output: "OnSoundFinished", callback: Remove });
	}
	SetTimer(OneShotSoundLifetime, Remove);
}

// For a looping sound: keeps playing until it's handed to StopSound
export function StartSoundOn(SoundEvent: string | undefined, Pawn: CSPlayerPawn): Entity[]
{
	return SpawnSoundOn(SoundEvent, Pawn);
}

export function StopSound(Entities: readonly Entity[]): void
{
	for (const Ent of Entities)
	{
		if (Ent.IsValid())
		{
			Ent.FireInput({ input: "StopSound" });
		}
	}
	SetTimer(StoppedSoundLifetime, (): void =>
	{
		RemoveEntities(Entities);
	});
}

export function PrecacheSounds(): void
{
	GSoundPrecache ??= Instance.Precache({ resources: [...SoundFiles], entities: [SoundEntityClass] });
}

// Debug: reports which entity classes Entities.Spawn will make, and whether the sound files have loaded
export function RunSpawnTest(Pawn: CSPlayerPawn): void
{
	const Precache: string = GSoundPrecache ? `server ${GSoundPrecache.IsServerLoaded()}, everyone ${GSoundPrecache.IsLoadedForAll()}` : "never made";
	Console.Log(`${LogPrefix} spawn test: sound precache loaded: ${Precache}`);
	for (const ClassName of SpawnTestClasses)
	{
		let Result: string;
		try
		{
			const Spawned: Entity[] = Entities.Spawn([{ classname: ClassName, origin: Pawn.GetAbsOrigin() }]);
			Result = `${Spawned.filter(IsValidEntity).length} of ${Spawned.length} valid`;
			RemoveEntities(Spawned);
		}
		catch (Exception)
		{
			Result = `threw ${String(Exception)}`;
		}
		Console.Log(`${LogPrefix} spawn test: ${ClassName}: ${Result}`);
	}
}

// Its source is the player, so it follows them; it's parented to them too.
// From the map's sound template if it has one, otherwise made in code
function SpawnSoundOn(SoundEvent: string | undefined, Pawn: CSPlayerPawn): Entity[]
{
	if (!SoundEvent || !Pawn.IsValid())
	{
		return [];
	}
	const SourceName: string = GetSoundSourceName(Pawn);
	const Spawned: Entity[] = SpawnSoundFromTemplate(SoundEvent, Pawn, SourceName) ?? SpawnSoundFromCode(SoundEvent, Pawn, SourceName);
	for (const Ent of Spawned)
	{
		Ent.SetParent(Pawn);
	}
	return Spawned;
}

// undefined when the map has no sound template
function SpawnSoundFromTemplate(SoundEvent: string, Pawn: CSPlayerPawn, SourceName: string): Entity[] | undefined
{
	const Template: PointTemplate | undefined = FindPointTemplate(SoundTemplateName);
	if (!Template)
	{
		return undefined;
	}
	const Spawned: Entity[] = (Template.ForceSpawn(Pawn.GetAbsOrigin()) ?? []).filter(IsValidEntity);
	for (const Ent of Spawned)
	{
		Ent.FireInput({ input: "SetSoundEventName", value: SoundEvent });
		Ent.FireInput({ input: "SetSourceEntity", value: SourceName });
		Ent.FireInput({ input: "StartSound" });
	}
	return Spawned;
}

// Gives up for good after the first failure, so the engine's error is only printed once
function SpawnSoundFromCode(SoundEvent: string, Pawn: CSPlayerPawn, SourceName: string): Entity[]
{
	if (GbSoundSpawnFailed)
	{
		return [];
	}
	let Spawned: Entity[] = [];
	try
	{
		Spawned = Entities.Spawn([
		{
			classname: SoundEntityClass,
			origin: Pawn.GetAbsOrigin(),
			soundName: SoundEvent,
			sourceEntityName: SourceName,
			entityIndexSelection: 1,
			startOnSpawn: true,
		}]).filter(IsValidEntity);
	}
	catch (Exception)
	{
		Console.Log(`${LogPrefix} Entities.Spawn failed: ${String(Exception)}`);
	}
	if (Spawned.length === 0)
	{
		GbSoundSpawnFailed = true;
		Console.Log(`${LogPrefix} couldn't make a ${SoundEntityClass} in code, so sounds are off until the map has a "${SoundTemplateName}"`);
	}
	return Spawned;
}

function IsValidEntity(Ent: Entity): boolean
{
	return Ent.IsValid();
}

function GetSoundSourceName(Pawn: CSPlayerPawn): string
{
	const Name: string = Pawn.GetEntityName();
	if (Name !== "")
	{
		return Name;
	}
	const NewName: string = `${SoundSourcePrefix}${GetPlayerSlot(Pawn)}`;
	Pawn.SetEntityName(NewName);
	return NewName;
}

// Beams ///////////////////////////////////////////////////////////////////////////////////////////

export function SpawnBeam(TemplateName: string, EndMarkerName: string, Start: FVector, End: FVector, Lifetime: number, FallbackColor: FColor): void
{
	const Spawned: Entity[] | undefined = SpawnBeamCopy(TemplateName, EndMarkerName, Start, End);
	if (!Spawned)
	{
		Instance.DebugLine({ start: Start, end: End, duration: Lifetime, color: FallbackColor });
		return;
	}
	SetTimer(Lifetime, (): void =>
	{
		RemoveBeamCopy(Spawned);
	});
}

// undefined when the map has no such template
function SpawnBeamCopy(TemplateName: string, EndMarkerName: string, Start: FVector, End: FVector): Entity[] | undefined
{
	const Template: PointTemplate | undefined = FindPointTemplate(TemplateName);
	if (!Template)
	{
		return undefined;
	}
	const Spawned: Entity[] = Template.ForceSpawn(Start, VectorMath.GetRotation(VectorMath.Subtract(End, Start))) ?? [];
	for (const Ent of Spawned)
	{
		if (Ent.GetEntityName().startsWith(EndMarkerName))
		{
			Ent.Teleport({ position: End });
		}
	}
	return Spawned;
}

export function SpawnHeldBeam(TemplateName: string, EndMarkerName: string, Start: FVector, End: FVector, FallbackColor: FColor, RefireInterval: number = 0): FHeldBeam
{
	const Beam: FHeldBeam = { TemplateName: TemplateName, EndMarkerName: EndMarkerName, FallbackColor: FallbackColor, Entities: [], RefireInterval: RefireInterval, NextRefireTime: 0, Copies: [] };
	if (RefireInterval > 0)
	{
		MoveHeldBeam(Beam, Start, End);
		return Beam;
	}
	const Template: PointTemplate | undefined = FindPointTemplate(TemplateName);
	if (Template)
	{
		Beam.Entities.push(...(Template.ForceSpawn(Start, VectorMath.GetRotation(VectorMath.Subtract(End, Start))) ?? []));
	}
	PlaceHeldBeam(Beam, Start, End, true);
	return Beam;
}

export function MoveHeldBeam(Beam: FHeldBeam, Start: FVector, End: FVector): void
{
	if (Beam.RefireInterval <= 0)
	{
		PlaceHeldBeam(Beam, Start, End, false);
		return;
	}
	const Now: number = Instance.GetGameTime();
	for (let Index: number = Beam.Copies.length - 1; Index >= 0; Index--)
	{
		const Copy: FBeamCopy | undefined = Beam.Copies[Index];
		if (Copy && Copy.RemoveAt <= Now)
		{
			RemoveBeamCopy(Copy.Entities);
			Beam.Copies.splice(Index, 1);
		}
	}
	if (Now < Beam.NextRefireTime)
	{
		return;
	}
	const bOnSchedule: boolean = Now - Beam.NextRefireTime < Beam.RefireInterval;
	Beam.NextRefireTime = (bOnSchedule ? Beam.NextRefireTime : Now) + Beam.RefireInterval;
	const Spawned: Entity[] | undefined = SpawnBeamCopy(Beam.TemplateName, Beam.EndMarkerName, Start, End);
	if (Spawned)
	{
		Beam.Copies.push({ Entities: Spawned, RemoveAt: Now + Math.max(RefiredBeamLifetime, Beam.RefireInterval) });
	}
	else
	{
		Instance.DebugLine({ start: Start, end: End, duration: Beam.RefireInterval, color: Beam.FallbackColor });
	}
}

export function RemoveHeldBeam(Beam: FHeldBeam): void
{
	RemoveEntities(Beam.Entities);
	for (const Copy of Beam.Copies)
	{
		RemoveBeamCopy(Copy.Entities);
	}
	Beam.Copies.length = 0;
}

function PlaceHeldBeam(Beam: FHeldBeam, Start: FVector, End: FVector, bTeleport: boolean): void
{
	if (Beam.Entities.length === 0)
	{
		Instance.DebugLine({ start: Start, end: End, duration: TickInterval * 2, color: Beam.FallbackColor });
		return;
	}

	const Angles: FRotator = VectorMath.GetRotation(VectorMath.Subtract(End, Start));
	for (const Ent of Beam.Entities)
	{
		if (!Ent.IsValid())
		{
			continue;
		}
		const bEndMarker: boolean = Ent.GetEntityName().startsWith(Beam.EndMarkerName);
		if (!bEndMarker && Ent.GetParent() !== undefined)
		{
			continue;
		}
		const Placement: { position: FVector, angles?: FRotator } = bEndMarker ? { position: End } : { position: Start, angles: Angles };
		if (bTeleport)
		{
			Ent.Teleport(Placement);
		}
		else
		{
			Ent.Move(Placement);
		}
	}
}

export function ClearDecals(): void
{
	for (const Decal of GDecals)
	{
		RemoveEntities(Decal);
	}
	GDecals = [];
}

function SpawnDecal(TemplateName: string, Position: FVector, SurfaceNormal: FVector): void
{
	const Template: PointTemplate | undefined = FindPointTemplate(TemplateName);
	if (!Template)
	{
		return;
	}

	const Rotation: FRotator = VectorMath.GetRotation(VectorMath.Scale(SurfaceNormal, -1), Math.random() * 360);
	const Spawned: Entity[] | undefined = Template.ForceSpawn(Position, Rotation);
	if (!Spawned || Spawned.length === 0)
	{
		return;
	}

	GDecals.push(Spawned);
	while (GDecals.length > MaxDecals)
	{
		const Oldest: Entity[] | undefined = GDecals.shift();
		if (Oldest)
		{
			RemoveEntities(Oldest);
		}
	}
}

function FindNearbySurface(Position: FVector, MaxDistance: number): TraceResult | undefined
{
	const Directions: readonly FVector[] =
	[
		{ x: 0, y: 0, z: -1 },
		{ x: 0, y: 0, z: 1 },
		{ x: 1, y: 0, z: 0 },
		{ x: -1, y: 0, z: 0 },
		{ x: 0, y: 1, z: 0 },
		{ x: 0, y: -1, z: 0 },
	];

	let Closest: TraceResult | undefined = undefined;
	for (const Direction of Directions)
	{
		const Trace: TraceResult = Instance.TraceLine(
		{
			start: Position,
			end: VectorMath.Add(Position, VectorMath.Scale(Direction, MaxDistance)),
			ignorePlayers: true,
		});
		if (Trace.didHit && !Trace.startedInSolid && (!Closest || Trace.fraction < Closest.fraction))
		{
			Closest = Trace;
		}
	}
	return Closest;
}

function RemoveBeamCopy(Entities: readonly Entity[]): void
{
	RemoveEntities(Entities.filter((Ent: Entity): boolean =>
	{
		return Ent.IsValid() && Ent.GetEntityName().endsWith(BeamParticleSuffix);
	}));
	SetTimer(BeamFxLingerTime, (): void =>
	{
		RemoveEntities(Entities);
	});
}

function RemoveEntities(Entities: readonly Entity[]): void
{
	for (const Ent of Entities)
	{
		if (Ent.IsValid())
		{
			Ent.Remove();
		}
	}
}
