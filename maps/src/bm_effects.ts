import { Instance } from "cs_script/point_script";
import type { Entity, CSPlayerPawn, TraceResult } from "cs_script/point_script";
import { FVectorMath, UpVector, IsPointTemplate, GetChestPosition } from "./bm_core";
import type { FVector, FRotator } from "./bm_core";

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const ScorchTemplateName: string = "scorch_template";
const BloodTemplateName: string = "blood_template";
const MaxDecals: number = 48;
const ScorchSearchDistance: number = 16;
const BloodSplatterDistance: number = 128;

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
	const Away: FVector = FVectorMath.GetSafeNormal(FVectorMath.Subtract(Chest, ExplosionOrigin));
	const Behind: TraceResult = Instance.TraceLine(
	{
		start: Chest,
		end: FVectorMath.Add(Chest, FVectorMath.Scale(Away, BloodSplatterDistance)),
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
		end: FVectorMath.Add(Chest, FVectorMath.Scale(UpVector, -BloodSplatterDistance)),
		ignorePlayers: true,
	});
	if (Below.didHit && !Below.startedInSolid)
	{
		SpawnDecal(BloodTemplateName, Below.end, Below.normal);
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
	const Template: Entity | undefined = Instance.FindEntityByName(TemplateName);
	if (!IsPointTemplate(Template))
	{
		return;
	}

	const Rotation: FRotator = FVectorMath.GetRotation(FVectorMath.Scale(SurfaceNormal, -1), Math.random() * 360);
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
			end: FVectorMath.Add(Position, FVectorMath.Scale(Direction, MaxDistance)),
			ignorePlayers: true,
		});
		if (Trace.didHit && !Trace.startedInSolid && (!Closest || Trace.fraction < Closest.fraction))
		{
			Closest = Trace;
		}
	}
	return Closest;
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
