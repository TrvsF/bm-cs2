import { Instance, Console, Entities, CSInputs } from "cs_script/point_script";
import type { Entity, CSPlayerPawn, CSPlayerController, CSWeaponBase, TraceResult } from "cs_script/point_script";
import { TickInterval, LogPrefix, ZeroVector, VectorMath, IsTeammate, GetChestPosition, GetOrCreate, SetBotControl, ForEachLivePawn } from "./bm_core";
import type { FVector, FRotator } from "./bm_core";
import { GetAimPoint, EvaluateDamageCurve } from "./bm_combat";
import type { FBallistics } from "./bm_combat";
import type { PlayerClass, FClassSettings, FBotShot } from "./bm_classes";
import type { FLauncherSettings } from "./bm_launcher";
import { EBuildHint, EBotBuildSite, GetBuildHints, GetPlacingKind, GetNextToBuild } from "./bm_buildings";
import type { BuildingKind, FBuildKey, FBuildKeys, FBuildHint, FBuildHints } from "./bm_buildings";

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
	// A bot only fires at a target it expects to do at least this much damage a second to
	readonly MinRating: number;
	readonly SwitchRatingScale: number;
	readonly DodgeSpeed: number;
	readonly BlastHitScale: number;
	readonly BuildInterval: number;
	readonly BuildRetryInterval: number;
	readonly BuildMaxPitch: number;
	readonly BuildYawSpread: number;
	// Teleporter entrances go within BuildSpawnRange of where the bot spawned; exits (and anything else, with no enemy about) at least BuildFrontDistance from it
	readonly BuildSpawnRange: number;
	readonly BuildFrontDistance: number;
	// Turrets and traps go where an enemy was seen this close and this lately
	readonly BuildEnemyRange: number;
	readonly BuildEnemyMemory: number;
}

interface FBotBuildJob
{
	readonly Input: number;
	readonly Kind: BuildingKind;
	readonly State: EBuildHint;
}

// How one bot plays. Each bot gets one at random and keeps it.
export interface FBotPersonality
{
	readonly Name: string;
	// Scales MinRating: below 1 it takes worse shots
	readonly MinRatingScale: number;
	readonly ReactionScale: number;
	readonly AimErrorScale: number;
	// Runs at whoever it sees at this speed until it is ChaseStopDistance away. 0 = leaves moving to the game.
	readonly ChaseSpeed: number;
}

interface FBotPick
{
	readonly Target: CSPlayerPawn;
	readonly WeaponName: string;
	readonly Rating: number;
	readonly Distance: number;
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
	BuildAim: FRotator;
	NextBuildTime: number;
	SpawnSpot: FVector;
	EnemySpot: FVector | undefined;
	EnemySeenAt: number;
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
	BuildEnemyMemory: 8,
};
export const BotPersonalities: FBotPersonality[] =
[
	{ Name: "aggressive", MinRatingScale: 0.5, ReactionScale: 0.5, AimErrorScale: 1.5, ChaseSpeed: 250 },
	{ Name: "steady", MinRatingScale: 1, ReactionScale: 1, AimErrorScale: 1, ChaseSpeed: 0 },
	{ Name: "careful", MinRatingScale: 2, ReactionScale: 1.25, AimErrorScale: 0.5, ChaseSpeed: 0 },
];
const FallbackPersonality: FBotPersonality = { Name: "steady", MinRatingScale: 1, ReactionScale: 1, AimErrorScale: 1, ChaseSpeed: 0 };
const ChaseStopDistance: number = 150;
const BotTargetRadius: number = 16;
const UnratedInterval: number = 1;
const BotRespawnGap: number = 0.5;
const BotDrawInterval: number = 0.5;

const GBotAssignments: Map<number, FBotAssignment> = new Map<number, FBotAssignment>();
const GBotReadyAt: Map<number, number> = new Map<number, number>();
const GBotFighters: Map<number, FBotFighter> = new Map<number, FBotFighter>();
const GBotPersonalities: Map<number, FBotPersonality> = new Map<number, FBotPersonality>();

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
	const Tool: CSWeaponBase | undefined = Definition.GetBotBuildTool(Pawn);
	if (GBotAssignments.has(Slot) || (Weapons.length === 0 && !Tool))
	{
		SetBotControl(Slot, undefined);
		return;
	}

	const Fighter: FBotFighter = GetOrCreate(GBotFighters, Slot, (): FBotFighter =>
	{
		return { WeaponName: undefined, Target: undefined, SeenAt: 0, Error: { pitch: 0, yaw: 0, roll: 0 }, NextErrorTime: 0, NextDrawTime: 0, LastTickTime: 0, bTap: false, BuildAim: { pitch: 0, yaw: 0, roll: 0 }, NextBuildTime: 0, SpawnSpot: Pawn.GetAbsOrigin(), EnemySpot: undefined, EnemySeenAt: 0 };
	});
	if (Now - Fighter.LastTickTime > BotRespawnGap)
	{
		Fighter.WeaponName = undefined;
		Fighter.Target = undefined;
		Fighter.NextBuildTime = Now + BotCombatSettings.BuildInterval;
		Fighter.SpawnSpot = Pawn.GetAbsOrigin();
		Fighter.EnemySpot = undefined;
	}
	Fighter.LastTickTime = Now;

	const Personality: FBotPersonality = GetBotPersonality(Slot, Controller);
	const Pick: FBotPick | undefined = FindBotTarget(Pawn, Fighter, Definition, Weapons, Personality);
	if ((Pick ? Pick.Target : undefined) !== Fighter.Target)
	{
		Fighter.Target = Pick ? Pick.Target : undefined;
		Fighter.SeenAt = Now;
	}
	if (Pick)
	{
		Fighter.WeaponName = Pick.WeaponName !== "" ? Pick.WeaponName : undefined;
		Fighter.EnemySpot = Pick.Target.GetAbsOrigin();
		Fighter.EnemySeenAt = Now;
	}
	const bChasing: boolean = Pick !== undefined && ChaseBotTarget(Pawn, Pick, Personality);
	if (Pick && Pick.Rating >= BotCombatSettings.MinRating * Personality.MinRatingScale)
	{
		AttackBotTarget(Pawn, Slot, Now, Definition, Fighter, Pick, Personality);
		return;
	}
	if (Pick && bChasing)
	{
		Pawn.SetEyeAngles(VectorMath.GetRotation(VectorMath.Subtract(GetChestPosition(Pick.Target), Pawn.GetEyePosition())));
	}
	else if (Tool && TickBotBuilding(Pawn, Slot, Now, Definition, Fighter, Tool))
	{
		return;
	}

	// Nothing worth shooting or building: the game moves it about until there is
	const WeaponName: string | undefined = Fighter.WeaponName ?? Weapons[0];
	const Weapon: CSWeaponBase | undefined = WeaponName !== undefined ? Pawn.FindWeapon(WeaponName) : undefined;
	DrawBotWeapon(Pawn, Fighter, Weapon, Now);
	SetBotControl(Slot, { Inputs: 0, Weapon: Weapon, Aim: Pawn.GetEyeAngles() });
}

export function ForgetBotCombat(Slot: number): void
{
	GBotFighters.delete(Slot);
	GBotPersonalities.delete(Slot);
	SetBotControl(Slot, undefined);
}

export function GetBotPersonality(Slot: number, Controller: CSPlayerController): FBotPersonality
{
	return GetOrCreate(GBotPersonalities, Slot, (): FBotPersonality =>
	{
		const Personality: FBotPersonality = BotPersonalities[Math.floor(Math.random() * BotPersonalities.length)] ?? FallbackPersonality;
		Console.Log(`${LogPrefix} bot ${Controller.GetPlayerName()} is ${Personality.Name}`);
		return Personality;
	});
}

// Runs straight at a target it can see. The game's own bot movement is overridden while it does.
function ChaseBotTarget(Pawn: CSPlayerPawn, Pick: FBotPick, Personality: FBotPersonality): boolean
{
	if (Personality.ChaseSpeed <= 0 || Pick.Distance <= ChaseStopDistance)
	{
		return false;
	}
	if (Pawn.GetGroundEntity())
	{
		const Offset: FVector = VectorMath.Subtract(Pick.Target.GetAbsOrigin(), Pawn.GetAbsOrigin());
		const Direction: FVector = VectorMath.GetSafeNormal({ x: Offset.x, y: Offset.y, z: 0 });
		Pawn.Teleport({ velocity: { x: Direction.x * Personality.ChaseSpeed, y: Direction.y * Personality.ChaseSpeed, z: Pawn.GetAbsVelocity().z } });
	}
	return true;
}

// The damage a second a bot expects from firing a weapon at something this far away
export function RateBotShot(Shot: FBotShot | undefined, Ballistics: FBallistics | undefined, Launcher: FLauncherSettings | undefined, Distance: number, AimError: number = BotCombatSettings.AimError): number
{
	if (!Shot)
	{
		return Infinity;
	}
	if (Distance > Shot.Range)
	{
		return 0;
	}
	const FlightTime: number = Ballistics && Ballistics.Speed > 0 ? Distance / Ballistics.Speed : 0;
	const MissAngle: number = ((Shot.Spread + AimError / 2) * Math.PI) / 180;
	const MissRadius: number = Distance * Math.tan(MissAngle) + BotCombatSettings.DodgeSpeed * FlightTime;
	const HitRadius: number = BotTargetRadius + Shot.BlastRadius * BotCombatSettings.BlastHitScale;
	const HitChance: number = Math.min(1, Math.pow(HitRadius / Math.max(1, MissRadius), 2));
	return (Shot.Damage * EvaluateDamageCurve(Shot.Falloff, Distance) * HitChance) / Math.max(TickInterval, GetBotFireInterval(Launcher));
}

// Seconds a shot when firing non-stop, reloads included
function GetBotFireInterval(Launcher: FLauncherSettings | undefined): number
{
	if (!Launcher)
	{
		return UnratedInterval;
	}
	const Reload: number = Launcher.ClipSize > 0 ? Launcher.ReloadFirstTime / Launcher.ClipSize + Launcher.ReloadEachTime : 0;
	return Launcher.FireInterval + Reload + (Launcher.bFireOnRelease ? 0 : Launcher.ChargeTime);
}

function GetBotLauncher(Definition: PlayerClass<FClassSettings>, WeaponName: string): FLauncherSettings | undefined
{
	return WeaponName === Definition.Settings.Primary ? Definition.Settings.PrimaryLauncher : Definition.Settings.SecondaryLauncher;
}

function RateBotWeapon(Definition: PlayerClass<FClassSettings>, WeaponName: string, Distance: number, Personality: FBotPersonality): number
{
	return RateBotShot(Definition.GetBotShot(WeaponName), Definition.GetBallistics(WeaponName), GetBotLauncher(Definition, WeaponName), Distance, BotCombatSettings.AimError * Personality.AimErrorScale);
}

// The enemy in sight it expects to hurt the most, and the weapon to do it with
function FindBotTarget(Pawn: CSPlayerPawn, Fighter: FBotFighter, Definition: PlayerClass<FClassSettings>, Weapons: string[], Personality: FBotPersonality): FBotPick | undefined
{
	const Eye: FVector = Pawn.GetEyePosition();
	const Facing: FVector = VectorMath.GetForwardVector(Pawn.GetEyeAngles());
	const MinFacing: number = Math.cos((BotCombatSettings.ViewCone * Math.PI) / 180);
	let Best: FBotPick | undefined = undefined;
	ForEachLivePawn((Other: CSPlayerPawn): void =>
	{
		if (Other === Pawn || IsTeammate(Other, Pawn))
		{
			return;
		}
		const Chest: FVector = GetChestPosition(Other);
		const Offset: FVector = VectorMath.Subtract(Chest, Eye);
		const Distance: number = VectorMath.Size(Offset);
		if (Distance >= BotCombatSettings.SightRange || (Other !== Fighter.Target && VectorMath.Dot(VectorMath.GetSafeNormal(Offset), Facing) < MinFacing))
		{
			return;
		}
		const Sight: TraceResult = Instance.TraceLine({ start: Eye, end: Chest, ignorePlayers: true });
		if (Sight.didHit && !Sight.startedInSolid)
		{
			return;
		}
		// A class with no weapon of its own still notices enemies: "" never rates high enough to fire
		for (const WeaponName of Weapons.length > 0 ? Weapons : [""])
		{
			// The weapon already out is preferred a little, so it doesn't keep swapping
			const Rating: number = (WeaponName !== "" ? RateBotWeapon(Definition, WeaponName, Distance, Personality) : 0) * (WeaponName === Fighter.WeaponName ? BotCombatSettings.SwitchRatingScale : 1);
			if (!Best || Rating > Best.Rating || (Rating === Best.Rating && Distance < Best.Distance))
			{
				Best = { Target: Other, WeaponName: WeaponName, Rating: Rating, Distance: Distance };
			}
		}
	});
	return Best;
}

function AttackBotTarget(Pawn: CSPlayerPawn, Slot: number, Now: number, Definition: PlayerClass<FClassSettings>, Fighter: FBotFighter, Pick: FBotPick, Personality: FBotPersonality): void
{
	const Weapon: CSWeaponBase | undefined = Pawn.FindWeapon(Pick.WeaponName);
	DrawBotWeapon(Pawn, Fighter, Weapon, Now);
	if (Now >= Fighter.NextErrorTime)
	{
		Fighter.Error = { pitch: GetRandomError() * Personality.AimErrorScale, yaw: GetRandomError() * Personality.AimErrorScale, roll: 0 };
		Fighter.NextErrorTime = Now + BotCombatSettings.AimErrorTime;
	}
	const Eye: FVector = Pawn.GetEyePosition();
	const AimPoint: FVector = GetAimPoint(Eye, GetChestPosition(Pick.Target), Pick.Target.GetAbsVelocity(), Definition.GetBallistics(Pick.WeaponName));
	const Direct: FRotator = VectorMath.GetRotation(VectorMath.Subtract(AimPoint, Eye));
	const Aim: FRotator = { pitch: Direct.pitch + Fighter.Error.pitch, yaw: Direct.yaw + Fighter.Error.yaw, roll: 0 };
	Pawn.SetEyeAngles(Aim);

	// A weapon that fires when its key comes back up is tapped; anything else is held down
	const Launcher: FLauncherSettings | undefined = GetBotLauncher(Definition, Pick.WeaponName);
	Fighter.bTap = !Fighter.bTap;
	const bReacted: boolean = Now - Fighter.SeenAt >= BotCombatSettings.ReactionTime * Personality.ReactionScale;
	const bFire: boolean = bReacted && (!Launcher || !Launcher.bFireOnRelease || Fighter.bTap);
	SetBotControl(Slot, { Inputs: bFire ? CSInputs.ATTACK : 0, Weapon: Weapon, Aim: Aim });
}

// Building ////////////////////////////////////////////////////////////////////////////////////////

function TickBotBuilding(Pawn: CSPlayerPawn, Slot: number, Now: number, Definition: PlayerClass<FClassSettings>, Fighter: FBotFighter, Tool: CSWeaponBase): boolean
{
	SetBotControl(Slot, { Inputs: 0, Weapon: Tool, Aim: Fighter.BuildAim });
	const Keys: FBuildKeys | undefined = Definition.GetBuildKeys(Pawn);
	if (!Keys)
	{
		return false;
	}
	const Hints: FBuildHints = GetBuildHints(Slot, Keys, Now);
	const Job: FBotBuildJob | undefined = FindBotBuildJob(Pawn, Slot, Now, Fighter, Keys.Left, Hints.Left, CSInputs.ATTACK)
		?? FindBotBuildJob(Pawn, Slot, Now, Fighter, Keys.Right, Hints.Right, CSInputs.ATTACK2);
	if (!Job)
	{
		return false;
	}
	DrawBotWeapon(Pawn, Fighter, Tool, Now);
	if (Now < Fighter.NextBuildTime)
	{
		return true;
	}

	if (Job.State !== EBuildHint.Placing)
	{
		Fighter.BuildAim = GetBotBuildAim(Pawn, Now, Fighter, Job.Kind.GetBotSite());
	}
	const bBlocked: boolean = Job.State === EBuildHint.Blocked;
	Fighter.NextBuildTime = Now + (bBlocked ? BotCombatSettings.BuildRetryInterval : BotCombatSettings.BuildInterval);
	SetBotControl(Slot, { Inputs: bBlocked ? 0 : Job.Input, Weapon: Tool, Aim: Fighter.BuildAim });
	return true;
}

function FindBotBuildJob(Pawn: CSPlayerPawn, Slot: number, Now: number, Fighter: FBotFighter, Key: FBuildKey, Hint: FBuildHint, Input: number): FBotBuildJob | undefined
{
	if (Hint.State !== EBuildHint.Ready && Hint.State !== EBuildHint.Placing && Hint.State !== EBuildHint.Blocked)
	{
		return undefined;
	}
	const Placing: BuildingKind | undefined = GetPlacingKind(Slot);
	if (Placing && Key.Kinds.includes(Placing))
	{
		return { Input: Input, Kind: Placing, State: Hint.State };
	}
	const Next: BuildingKind | undefined = GetNextToBuild(Slot, Key.Kinds);
	return Next && IsBotBuildSite(Pawn, Now, Fighter, Next.GetBotSite()) ? { Input: Input, Kind: Next, State: Hint.State } : undefined;
}

function IsBotBuildSite(Pawn: CSPlayerPawn, Now: number, Fighter: FBotFighter, Site: EBotBuildSite): boolean
{
	const FromSpawn: number = VectorMath.Size(VectorMath.Subtract(Pawn.GetAbsOrigin(), Fighter.SpawnSpot));
	if (Site === EBotBuildSite.AtSpawn)
	{
		return FromSpawn <= BotCombatSettings.BuildSpawnRange;
	}
	return FromSpawn >= BotCombatSettings.BuildFrontDistance || (Site === EBotBuildSite.NearEnemies && GetBotEnemySpot(Pawn, Now, Fighter) !== undefined);
}

function GetBotEnemySpot(Pawn: CSPlayerPawn, Now: number, Fighter: FBotFighter): FVector | undefined
{
	const Spot: FVector | undefined = Fighter.EnemySpot;
	const bKnown: boolean = Spot !== undefined && Now - Fighter.EnemySeenAt <= BotCombatSettings.BuildEnemyMemory
		&& VectorMath.Size(VectorMath.Subtract(Spot, Pawn.GetAbsOrigin())) <= BotCombatSettings.BuildEnemyRange;
	return bKnown ? Spot : undefined;
}

function GetBotBuildAim(Pawn: CSPlayerPawn, Now: number, Fighter: FBotFighter, Site: EBotBuildSite): FRotator
{
	const Pitch: number = Math.random() * BotCombatSettings.BuildMaxPitch;
	if (Site === EBotBuildSite.AtSpawn)
	{
		return { pitch: Pitch, yaw: Math.random() * 360 - 180, roll: 0 };
	}
	const Origin: FVector = Pawn.GetAbsOrigin();
	const EnemySpot: FVector | undefined = Site === EBotBuildSite.NearEnemies ? GetBotEnemySpot(Pawn, Now, Fighter) : undefined;
	const Onwards: FVector = EnemySpot ? VectorMath.Subtract(EnemySpot, Origin) : VectorMath.Subtract(Origin, Fighter.SpawnSpot);
	const Yaw: number = VectorMath.GetRotation(Onwards).yaw + (Math.random() * 2 - 1) * BotCombatSettings.BuildYawSpread;
	return { pitch: Pitch, yaw: Yaw, roll: 0 };
}

function DrawBotWeapon(Pawn: CSPlayerPawn, Fighter: FBotFighter, Weapon: CSWeaponBase | undefined, Now: number): void
{
	if (Now < Fighter.NextDrawTime)
	{
		return;
	}
	Fighter.NextDrawTime = Now + BotDrawInterval;
	if (Weapon && Pawn.GetActiveWeapon() !== Weapon)
	{
		Pawn.SwitchToWeapon(Weapon);
	}
}

function GetRandomError(): number
{
	return (Math.random() * 2 - 1) * BotCombatSettings.AimError;
}