import { Instance } from "cs_script/point_script";
import type { Entity, CSPlayerPawn, CSPlayerController, TraceResult } from "cs_script/point_script";
import { ZeroVector, VectorMath, ForEachLivePawn } from "./bm_core";
import type { FVector } from "./bm_core";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

enum EBotMode
{
	Still,
	Run,
	Jump,
}

interface FBotAssignment
{
	Marker: Entity;
	Mode: EBotMode;
	Yaw: number;
	bPlaced: boolean;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const BotMarkerModes: ReadonlyMap<string, EBotMode> = new Map<string, EBotMode>(
	[
		["bot_still", EBotMode.Still],
		["bot_run", EBotMode.Run],
		["bot_jump", EBotMode.Jump],
	]
);
const BotRunSpeed: number = 250;
const BotJumpSpeed: number = 301;
const BotSpawnSettleTime: number = 0.1;

const GBotAssignments: Map<number, FBotAssignment> = new Map<number, FBotAssignment>();
const GBotReadyAt: Map<number, number> = new Map<number, number>();

// Bots ////////////////////////////////////////////////////////////////////////////////////////////

export function TickBots(Now: number): void
{
	const FreeMarkers: Map<Entity, EBotMode> = FindFreeBotMarkers();

	ForEachLivePawn((Pawn: CSPlayerPawn, Slot: number): void =>
	{
		const Controller: CSPlayerController | undefined = Pawn.GetPlayerController();
		if (!Controller || !Controller.IsBot())
		{
			return;
		}

		const ReadyAt: number | undefined = GBotReadyAt.get(Slot);
		if (ReadyAt !== undefined && Now < ReadyAt)
		{
			return;
		}

		let Assignment: FBotAssignment | undefined = GBotAssignments.get(Slot);
		if (!Assignment)
		{
			Assignment = ClaimBotMarker(Slot, FreeMarkers);
			if (!Assignment)
			{
				return;
			}
		}
		if (!Assignment.bPlaced)
		{
			PlaceBotOnMarker(Pawn, Assignment);
		}
		DriveBot(Pawn, Assignment);
	});
}

export function ResetBotMode(Slot: number): void
{
	const Assignment: FBotAssignment | undefined = GBotAssignments.get(Slot);
	if (Assignment)
	{
		Assignment.bPlaced = false;
	}
	GBotReadyAt.set(Slot, Instance.GetGameTime() + BotSpawnSettleTime);
}

export function ForgetBot(Slot: number): void
{
	GBotAssignments.delete(Slot);
	GBotReadyAt.delete(Slot);
}

function FindFreeBotMarkers(): Map<Entity, EBotMode>
{
	const Claimed: Set<Entity> = new Set<Entity>();
	for (const Assignment of GBotAssignments.values())
	{
		Claimed.add(Assignment.Marker);
	}

	const FreeMarkers: Map<Entity, EBotMode> = new Map<Entity, EBotMode>();
	for (const [MarkerName, Mode] of BotMarkerModes)
	{
		for (const Marker of Instance.FindEntitiesByName(MarkerName))
		{
			if (Marker.IsValid() && !Claimed.has(Marker))
			{
				FreeMarkers.set(Marker, Mode);
			}
		}
	}
	return FreeMarkers;
}

function ClaimBotMarker(Slot: number, FreeMarkers: Map<Entity, EBotMode>): FBotAssignment | undefined
{
	for (const [Marker, Mode] of FreeMarkers)
	{
		FreeMarkers.delete(Marker);
		const Assignment: FBotAssignment = { Marker: Marker, Mode: Mode, Yaw: 0, bPlaced: false };
		GBotAssignments.set(Slot, Assignment);
		return Assignment;
	}
	return undefined;
}

function PlaceBotOnMarker(Pawn: CSPlayerPawn, Assignment: FBotAssignment): void
{
	if (!Assignment.Marker.IsValid())
	{
		return;
	}
	Assignment.Yaw = Assignment.Marker.GetAbsAngles().yaw;
	Assignment.bPlaced = true;
	Pawn.Teleport({ position: Assignment.Marker.GetAbsOrigin(), angles: { pitch: 0, yaw: Assignment.Yaw, roll: 0 }, velocity: ZeroVector });
	Pawn.SetEyeAngles({ pitch: 0, yaw: Assignment.Yaw, roll: 0 });
	Pawn.SetHealth(Pawn.GetMaxHealth());
}

function DriveBot(Pawn: CSPlayerPawn, Assignment: FBotAssignment): void
{
	if (Assignment.Mode === EBotMode.Still || !Pawn.GetGroundEntity())
	{
		return;
	}

	if (Assignment.Mode === EBotMode.Jump)
	{
		Pawn.Teleport({ velocity: { x: 0, y: 0, z: BotJumpSpeed } });
		return;
	}

	const Forward: FVector = VectorMath.GetForwardVector({ pitch: 0, yaw: Assignment.Yaw, roll: 0 });
	Pawn.Teleport({ velocity: { x: Forward.x * BotRunSpeed, y: Forward.y * BotRunSpeed, z: Pawn.GetAbsVelocity().z } });
}