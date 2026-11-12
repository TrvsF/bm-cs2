import { Instance, Entities, CSInputs } from "cs_script/point_script";
import type { Entity, CSPlayerPawn, CSPlayerController, CSWeaponBase, TraceResult } from "cs_script/point_script";
import { ZeroVector, VectorMath, IsTeammate, GetChestPosition, GetOrCreate, SetBotControl, ForEachLivePawn } from "./bm_core";
import type { FVector, FRotator } from "./bm_core";
import { GetAimPoint } from "./bm_combat";
import type { PlayerClass, FClassSettings } from "./bm_classes";
import type { FLauncherSettings } from "./bm_launcher";

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

export interface FBotCombatSettings
{
	readonly SightRange: number;
	readonly ViewCone: number;
	readonly ReactionTime: number;
	readonly AimError: number;
	readonly AimErrorTime: number;
}

interface FBotFighter
{
	WeaponName: string | undefined;
	Target: CSPlayerPawn | undefined;
	SeenAt: number;
	Error: FRotator;
	NextErrorTime: number;
	NextDrawTime: number;
	LastTickTime: number;
	bTap: boolean;
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

export const BotCombatSettings: FBotCombatSettings =
{
	SightRange: 2500,
	ViewCone: 75,
	ReactionTime: 0.4,
	AimError: 3,
	AimErrorTime: 0.5,
};
const BotRespawnGap: number = 0.5;
const BotDrawInterval: number = 0.5;

const GBotAssignments: Map<number, FBotAssignment> = new Map<number, FBotAssignment>();
const GBotReadyAt: Map<number, number> = new Map<number, number>();
const GBotFighters: Map<number, FBotFighter> = new Map<number, FBotFighter>();

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
		for (const Marker of Entities.FindByName(MarkerName))
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
// Combat //////////////////////////////////////////////////////////////////////////////////////////

export function TickBotCombat(Pawn: CSPlayerPawn, Slot: number, Now: number, Definition: PlayerClass<FClassSettings>): void
{
	const Controller: CSPlayerController | undefined = Pawn.GetPlayerController();
	if (!Controller || !Controller.IsBot())
	{
		return;
	}
	const Weapons: string[] = Definition.GetBotWeapons();
	if (GBotAssignments.has(Slot) || Weapons.length === 0)
	{
		SetBotControl(Slot, undefined);
		return;
	}

	const Fighter: FBotFighter = GetOrCreate(GBotFighters, Slot, (): FBotFighter =>
	{
		return { WeaponName: undefined, Target: undefined, SeenAt: 0, Error: { pitch: 0, yaw: 0, roll: 0 }, NextErrorTime: 0, NextDrawTime: 0, LastTickTime: 0, bTap: false };
	});
	// Each life it uses one of its class's weapons
	if (Fighter.WeaponName === undefined || !Weapons.includes(Fighter.WeaponName) || Now - Fighter.LastTickTime > BotRespawnGap)
	{
		Fighter.WeaponName = Weapons[Math.floor(Math.random() * Weapons.length)];
		Fighter.Target = undefined;
	}
	Fighter.LastTickTime = Now;
	const WeaponName: string = Fighter.WeaponName ?? Weapons[0];
	DrawBotWeapon(Pawn, Fighter, WeaponName, Now);

	const Target: CSPlayerPawn | undefined = FindBotTarget(Pawn, Fighter.Target);
	if (Target !== Fighter.Target)
	{
		Fighter.Target = Target;
		Fighter.SeenAt = Now;
	}
	if (!Target)
	{
		SetBotControl(Slot, { Inputs: 0, WeaponName: WeaponName, Aim: Pawn.GetEyeAngles() });
		return;
	}

	if (Now >= Fighter.NextErrorTime)
	{
		Fighter.Error = { pitch: GetRandomError(), yaw: GetRandomError(), roll: 0 };
		Fighter.NextErrorTime = Now + BotCombatSettings.AimErrorTime;
	}
	const Eye: FVector = Pawn.GetEyePosition();
	const AimPoint: FVector = GetAimPoint(Eye, GetChestPosition(Target), Target.GetAbsVelocity(), Definition.GetBallistics(WeaponName));
	const Direct: FRotator = VectorMath.GetRotation(VectorMath.Subtract(AimPoint, Eye));
	const Aim: FRotator = { pitch: Direct.pitch + Fighter.Error.pitch, yaw: Direct.yaw + Fighter.Error.yaw, roll: 0 };
	Pawn.SetEyeAngles(Aim);

	// A weapon that fires when its key comes back up is tapped; anything else is held down
	const Launcher: FLauncherSettings | undefined = WeaponName === Definition.Settings.Primary ? Definition.Settings.PrimaryLauncher : Definition.Settings.SecondaryLauncher;
	Fighter.bTap = !Fighter.bTap;
	const bReacted: boolean = Now - Fighter.SeenAt >= BotCombatSettings.ReactionTime;
	const bFire: boolean = bReacted && (!Launcher || !Launcher.bFireOnRelease || Fighter.bTap);
	SetBotControl(Slot, { Inputs: bFire ? CSInputs.ATTACK : 0, WeaponName: WeaponName, Aim: Aim });
}

export function ForgetBotCombat(Slot: number): void
{
	GBotFighters.delete(Slot);
	SetBotControl(Slot, undefined);
}

function FindBotTarget(Pawn: CSPlayerPawn, Current: CSPlayerPawn | undefined): CSPlayerPawn | undefined
{
	const Eye: FVector = Pawn.GetEyePosition();
	const Facing: FVector = VectorMath.GetForwardVector(Pawn.GetEyeAngles());
	const MinFacing: number = Math.cos((BotCombatSettings.ViewCone * Math.PI) / 180);
	let Best: CSPlayerPawn | undefined = undefined;
	let BestDistance: number = BotCombatSettings.SightRange;
	ForEachLivePawn((Other: CSPlayerPawn): void =>
	{
		if (Other === Pawn || IsTeammate(Other, Pawn))
		{
			return;
		}
		const Chest: FVector = GetChestPosition(Other);
		const Offset: FVector = VectorMath.Subtract(Chest, Eye);
		const Distance: number = VectorMath.Size(Offset);
		if (Distance >= BestDistance || (Other !== Current && VectorMath.Dot(VectorMath.GetSafeNormal(Offset), Facing) < MinFacing))
		{
			return;
		}
		const Sight: TraceResult = Instance.TraceLine({ start: Eye, end: Chest, ignorePlayers: true });
		if (Sight.didHit && !Sight.startedInSolid)
		{
			return;
		}
		Best = Other;
		BestDistance = Distance;
	});
	return Best;
}

function DrawBotWeapon(Pawn: CSPlayerPawn, Fighter: FBotFighter, WeaponName: string, Now: number): void
{
	if (Now < Fighter.NextDrawTime)
	{
		return;
	}
	Fighter.NextDrawTime = Now + BotDrawInterval;
	const Weapon: CSWeaponBase | undefined = Pawn.FindWeapon(WeaponName);
	if (Weapon && Pawn.GetActiveWeapon() !== Weapon)
	{
		Pawn.SwitchToWeapon(Weapon);
	}
}

function GetRandomError(): number
{
	return (Math.random() * 2 - 1) * BotCombatSettings.AimError;
}