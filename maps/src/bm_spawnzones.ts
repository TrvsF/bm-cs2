import { Instance, Console } from "cs_script/point_script";
import type { Entity, CSPlayerPawn } from "cs_script/point_script";
import { LogPrefix, ETeam, ZeroVector, VectorMath, IsPlayerPawn, GetPlayerSlot, ForEachLivePawn, INDEX_NONE } from "./bm_core";
import type { FVector } from "./bm_core";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FSpawnZoneSettings
{
	readonly TerroristZoneName: string;
	readonly CounterTerroristZoneName: string;
	readonly PushOutSpeed: number;
}

interface FSpawnZone
{
	readonly Entity: Entity;
	readonly Team: ETeam;
	readonly Touching: Set<number>;
}

interface FZoneVisitor
{
	readonly History: FVector[];
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

export const SpawnZoneSettings: FSpawnZoneSettings =
{
	TerroristZoneName: "spawnzone_t",
	CounterTerroristZoneName: "spawnzone_ct",
	PushOutSpeed: 250,
};

const RescanInterval: number = 1;
const TouchRefreshDelay: number = 0.05;
const SafeHistoryTicks: number = 8;

let GZones: FSpawnZone[] = [];
const GVisitors: Map<number, FZoneVisitor> = new Map<number, FZoneVisitor>();
let GNextScanTime: number = 0;
let GLastScanReport: string = "";

// Spawn zones /////////////////////////////////////////////////////////////////////////////////////

export function TickSpawnZones(Now: number): void
{
	if (Now >= GNextScanTime)
	{
		GNextScanTime = Now + RescanInterval;
		ScanSpawnZones();
	}
	
	if (GZones.length === 0)
	{
		return;
	}

	ForEachLivePawn((Pawn: CSPlayerPawn, Slot: number): void =>
	{
		const Visitor: FZoneVisitor = GetVisitor(Slot);
		const EnemyZone: FSpawnZone | undefined = FindEnemyZone(Pawn, Slot);
		if (EnemyZone)
		{
			PushOut(Pawn, Slot, Visitor, EnemyZone);
			return;
		}
		Visitor.History.push(Pawn.GetAbsOrigin());
		if (Visitor.History.length > SafeHistoryTicks)
		{
			Visitor.History.shift();
		}
	});
}

export function ResetSpawnZones(): void
{
	GVisitors.clear();
	GNextScanTime = 0;
}

export function ForgetSpawnZonePlayer(Slot: number): void
{
	for (const Zone of GZones)
	{
		Zone.Touching.delete(Slot);
	}
	GVisitors.delete(Slot);
}

export function ForgetSpawnZoneHistory(Slot: number): void
{
	GVisitors.delete(Slot);
}

export function RefreshSpawnZoneTouches(): void
{
	for (const Zone of GZones)
	{
		RefreshTouches(Zone);
	}
}

export function IsInFriendlySpawnZone(Pawn: CSPlayerPawn, Slot: number): boolean
{
	const Team: number = Pawn.GetTeamNumber();
	return GZones.some((Zone: FSpawnZone): boolean =>
	{
		return Zone.Team === Team && Zone.Touching.has(Slot) && Zone.Entity.IsValid();
	});
}

function ScanSpawnZones(): void
{
	GZones = GZones.filter((Zone: FSpawnZone): boolean =>
	{
		return Zone.Entity.IsValid();
	});
	AddZones(SpawnZoneSettings.TerroristZoneName, ETeam.Terrorist);
	AddZones(SpawnZoneSettings.CounterTerroristZoneName, ETeam.CounterTerrorist);

	const TerroristZones: number = CountZones(ETeam.Terrorist);
	const CounterTerroristZones: number = CountZones(ETeam.CounterTerrorist);
	const Report: string = TerroristZones + CounterTerroristZones > 0
		? `spawn zones: ${TerroristZones} for Ts ("${SpawnZoneSettings.TerroristZoneName}"), ${CounterTerroristZones} for CTs ("${SpawnZoneSettings.CounterTerroristZoneName}")`
		: "";
	if (Report !== "" && Report !== GLastScanReport)
	{
		Console.Log(`${LogPrefix} ${Report}`);
	}
	GLastScanReport = Report;
}

function AddZones(Name: string, Team: ETeam): void
{
	for (const Ent of Instance.FindEntitiesByName(`${Name}*`))
	{
		const bKnown: boolean = GZones.some((Zone: FSpawnZone): boolean =>
		{
			return Zone.Entity === Ent;
		});
		if (bKnown || !Ent.IsValid())
		{
			continue;
		}

		const Zone: FSpawnZone = { Entity: Ent, Team: Team, Touching: new Set<number>() };
		GZones.push(Zone);
		Instance.ConnectOutput(Ent, "OnStartTouch", (InputData: { activator?: Entity }): void =>
		{
			const Slot: number = GetToucherSlot(InputData.activator);
			if (Slot !== INDEX_NONE)
			{
				Zone.Touching.add(Slot);
			}
		});
		Instance.ConnectOutput(Ent, "OnEndTouch", (InputData: { activator?: Entity }): void =>
		{
			Zone.Touching.delete(GetToucherSlot(InputData.activator));
		});
		RefreshTouches(Zone);
	}
}

function RefreshTouches(Zone: FSpawnZone): void
{
	if (!Zone.Entity.IsValid())
	{
		return;
	}
	Instance.EntFireAtTarget({ target: Zone.Entity, input: "Disable" });
	Instance.EntFireAtTarget({ target: Zone.Entity, input: "Enable", delay: TouchRefreshDelay });
}

function CountZones(Team: ETeam): number
{
	return GZones.filter((Zone: FSpawnZone): boolean =>
	{
		return Zone.Team === Team && Zone.Entity.IsValid();
	}).length;
}

function GetToucherSlot(Activator: Entity | undefined): number
{
	return IsPlayerPawn(Activator) ? GetPlayerSlot(Activator) : INDEX_NONE;
}

function FindEnemyZone(Pawn: CSPlayerPawn, Slot: number): FSpawnZone | undefined
{
	const Team: number = Pawn.GetTeamNumber();
	return GZones.find((Zone: FSpawnZone): boolean =>
	{
		return Zone.Team !== Team && Zone.Touching.has(Slot) && Zone.Entity.IsValid();
	});
}

function GetVisitor(Slot: number): FZoneVisitor
{
	let Visitor: FZoneVisitor | undefined = GVisitors.get(Slot);
	if (!Visitor)
	{
		Visitor = { History: [] };
		GVisitors.set(Slot, Visitor);
	}
	return Visitor;
}

function PushOut(Pawn: CSPlayerPawn, Slot: number, Visitor: FZoneVisitor, Zone: FSpawnZone): void
{
	Zone.Touching.delete(Slot);
	const SafeSpot: FVector | undefined = Visitor.History[0];
	if (SafeSpot)
	{
		Pawn.Teleport({ position: SafeSpot, velocity: ZeroVector });
		return;
	}

	const Offset: FVector = VectorMath.Subtract(Pawn.GetAbsOrigin(), Zone.Entity.GetAbsOrigin());
	const Away: FVector = VectorMath.GetSafeNormal({ x: Offset.x, y: Offset.y, z: 0 });
	Pawn.Teleport({ velocity: VectorMath.Scale(Away, SpawnZoneSettings.PushOutSpeed) });
}