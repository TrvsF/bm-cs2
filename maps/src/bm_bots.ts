import { Instance, Console, GameRules, Entities, CSInputs, CSGearSlot } from "cs_script/point_script";
import type { Entity, CSPlayerPawn, CSPlayerController, CSWeaponBase, TraceResult, PlayerTraceResult } from "cs_script/point_script";
import { TickInterval, LogPrefix, ZeroVector, GetPlayerSlot, VectorMath, IsTeammate, GetChestPosition, GetOrCreate, SetBotControl, ForEachLivePawn } from "./bm_core";
import type { FVector, FRotator } from "./bm_core";
import { GetAimPoint, EvaluateDamageCurve } from "./bm_combat";
import type { FBallistics } from "./bm_combat";
import type { PlayerClass, FClassSettings, FBotShot, FHudCounter } from "./bm_classes";
import type { FLauncherSettings } from "./bm_launcher";
import { EBuildHint, EBotBuildSite, GetBuildHints, GetPlacingKind, GetNextToBuild, GetEnemyBuildings, GetBuildingCenter } from "./bm_buildings";
import type { BuildingKind, FBuilding, FBuildKey, FBuildKeys, FBuildHint, FBuildHints } from "./bm_buildings";

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
	// A bot that has moved less than CampRadius in CampCheckInterval seconds is walked towards the nearest enemy for RoamTime
	readonly CampCheckInterval: number;
	readonly CampRadius: number;
	readonly RoamTime: number;
	readonly RoamSpeed: number;
	readonly RoamProbe: number;
	readonly RoamSteerInterval: number;
	// A healer bot walks up to within HealFollowDistance of its patient, and picks another once it is HealLeashRange away
	readonly HealFollowDistance: number;
	readonly HealLeashRange: number;
	// Blast and recoil jumps: a moving bot hops, aims down behind itself and fires a weapon that throws its shooter
	readonly JumpMinSpeed: number;
	readonly JumpSpeed: number;
	readonly JumpHoldTime: number;
	readonly JumpBlastPitch: number;
	readonly JumpRecoilPitch: number;
	readonly JumpMinHealth: number;
	// It only jumps with this much clear way ahead and ground to land on
	readonly JumpClearDistance: number;
	readonly JumpLandDrop: number;
	// For classes whose bots knife: it walks to the spot StabBehindDistance behind its target's back, and stops pushing within StabArriveDistance of it
	readonly StabBehindDistance: number;
	readonly StabArriveDistance: number;
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
	// Always walks towards the nearest enemy, not just when it has been camping
	readonly bHunts: boolean;
	// Seconds between blast or recoil jumps, give or take half. 0 = never jumps.
	readonly JumpInterval: number;
}

interface FBotPick
{
	readonly Target: CSPlayerPawn | FBuilding;
	readonly Spot: FVector;
	readonly Velocity: FVector;
	readonly Feet: FVector;
	readonly WeaponName: string;
	readonly Rating: number;
	readonly Distance: number;
}

interface FBotFighter
{
	WeaponName: string | undefined;
	Target: CSPlayerPawn | FBuilding | undefined;
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
	CampSpot: FVector;
	NextCampCheckTime: number;
	RoamUntil: number;
	RoamYaw: number;
	NextSteerTime: number;
	Patient: CSPlayerPawn | undefined;
	NextJumpTime: number;
	JumpUntil: number;
	JumpYaw: number;
	JumpWeaponName: string;
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
	CampCheckInterval: 3,
	CampRadius: 150,
	RoamTime: 4,
	RoamSpeed: 250,
	RoamProbe: 80,
	RoamSteerInterval: 0.25,
	HealFollowDistance: 200,
	HealLeashRange: 1500,
	JumpMinSpeed: 150,
	JumpSpeed: 290,
	JumpHoldTime: 0.3,
	JumpBlastPitch: 70,
	JumpRecoilPitch: 45,
	JumpMinHealth: 0.6,
	JumpClearDistance: 350,
	JumpLandDrop: 300,
	StabBehindDistance: 40,
	StabArriveDistance: 16,
};
export const BotPersonalities: FBotPersonality[] =
[
	{ Name: "aggressive", MinRatingScale: 0.5, ReactionScale: 0.5, AimErrorScale: 1.5, ChaseSpeed: 250, bHunts: true, JumpInterval: 4 },
	{ Name: "steady", MinRatingScale: 1, ReactionScale: 1, AimErrorScale: 1, ChaseSpeed: 0, bHunts: false, JumpInterval: 9 },
	{ Name: "careful", MinRatingScale: 2, ReactionScale: 1.25, AimErrorScale: 0.5, ChaseSpeed: 0, bHunts: false, JumpInterval: 0 },
];
const FallbackPersonality: FBotPersonality = { Name: "steady", MinRatingScale: 1, ReactionScale: 1, AimErrorScale: 1, ChaseSpeed: 0, bHunts: false, JumpInterval: 9 };
const ChaseStopDistance: number = 150;
const RoamStepHeight: number = 18;
const BotJumpRetryInterval: number = 0.5;
const RoamTurns: readonly number[] = [0, 35, -35, 70, -70, 110, -110, 150, -150];
const BotTargetRadius: number = 16;
const UnratedInterval: number = 1;
const BotRespawnGap: number = 0.5;
const BotDrawInterval: number = 0.5;

const GBotAssignments: Map<number, FBotAssignment> = new Map<number, FBotAssignment>();
const GBotReadyAt: Map<number, number> = new Map<number, number>();
const GBotFighters: Map<number, FBotFighter> = new Map<number, FBotFighter>();
const GBotPersonalities: Map<number, FBotPersonality> = new Map<number, FBotPersonality>();
const GBotHealers: Map<number, number> = new Map<number, number>();
// Keys the bot's class wants held this tick, on top of whatever the bot itself presses
let GBotClassInputs: number = 0;

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
		return {
			WeaponName: undefined, Target: undefined, SeenAt: 0, Error: { pitch: 0, yaw: 0, roll: 0 }, NextErrorTime: 0, NextDrawTime: 0, LastTickTime: 0, bTap: false,
			BuildAim: { pitch: 0, yaw: 0, roll: 0 }, NextBuildTime: 0, SpawnSpot: Pawn.GetAbsOrigin(), EnemySpot: undefined, EnemySeenAt: 0,
			CampSpot: Pawn.GetAbsOrigin(), NextCampCheckTime: 0, RoamUntil: 0, RoamYaw: 0, NextSteerTime: 0, Patient: undefined,
			NextJumpTime: 0, JumpUntil: 0, JumpYaw: 0, JumpWeaponName: "",
		};
	});
	if (Now - Fighter.LastTickTime > BotRespawnGap)
	{
		Fighter.WeaponName = undefined;
		Fighter.Target = undefined;
		Fighter.NextBuildTime = Now + BotCombatSettings.BuildInterval;
		Fighter.SpawnSpot = Pawn.GetAbsOrigin();
		Fighter.EnemySpot = undefined;
		Fighter.CampSpot = Fighter.SpawnSpot;
		Fighter.NextCampCheckTime = Now + BotCombatSettings.CampCheckInterval;
		Fighter.RoamUntil = 0;
		Fighter.Patient = undefined;
		Fighter.JumpUntil = 0;
		Fighter.NextJumpTime = Now + BotCombatSettings.CampCheckInterval;
	}
	Fighter.LastTickTime = Now;
	GBotClassInputs = 0;

	if (GameRules.IsFreezePeriod())
	{
		// Nothing to do yet: its hands are left alone, so it doesn't keep swapping weapons with the game's AI
		IdleBot(Pawn, Slot, Fighter, Weapons);
		return;
	}

	if (TickBotJump(Pawn, Slot, Now, Definition, Fighter))
	{
		return;
	}
	if (Definition.IsBotHealer() && TickBotHealer(Pawn, Slot, Now, Definition, Fighter))
	{
		return;
	}
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
		Fighter.EnemySpot = Pick.Feet;
		Fighter.EnemySeenAt = Now;
	}
	const Enemy: CSPlayerPawn | undefined = Pick && !("Kind" in Pick.Target) ? Pick.Target : undefined;
	GBotClassInputs = Definition.GetBotInputs(Pawn, Slot, Now, Enemy);
	if (Enemy && Definition.IsBotStabber() && TickBotStab(Pawn, Slot, Now, Fighter, Enemy))
	{
		return;
	}
	const bChasing: boolean = Pick !== undefined && ChaseBotTarget(Pawn, Pick, Personality);
	if (Pick && Pick.Rating >= BotCombatSettings.MinRating * Personality.MinRatingScale)
	{
		// Fighting where it stands isn't camping
		Fighter.NextCampCheckTime = Now + BotCombatSettings.CampCheckInterval;
		Fighter.CampSpot = Pawn.GetAbsOrigin();
		AttackBotTarget(Pawn, Slot, Now, Definition, Fighter, Pick, Personality);
		return;
	}
	if (!bChasing)
	{
		RoamBot(Pawn, Now, Fighter, Personality);
	}
	if (Pick && bChasing)
	{
		Pawn.SetEyeAngles(VectorMath.GetRotation(VectorMath.Subtract(Pick.Spot, Pawn.GetEyePosition())));
	}
	StartBotJump(Pawn, Now, Definition, Fighter, Weapons, Personality);
	if (!bChasing && Tool && TickBotBuilding(Pawn, Slot, Now, Definition, Fighter, Tool))
	{
		return;
	}

	IdleBot(Pawn, Slot, Fighter, Weapons);
}

function ControlBot(Slot: number, Inputs: number, Weapon: CSWeaponBase | undefined, Aim: FRotator): void
{
	SetBotControl(Slot, { Inputs: Inputs | GBotClassInputs, Weapon: Weapon, Aim: Aim });
}

// Jumping /////////////////////////////////////////////////////////////////////////////////////////

// A bot on the move with a weapon that throws its shooter (a rocket's blast, a shotgun's recoil) and room ahead starts a jump
function StartBotJump(Pawn: CSPlayerPawn, Now: number, Definition: PlayerClass<FClassSettings>, Fighter: FBotFighter, Weapons: string[], Personality: FBotPersonality): void
{
	if (Personality.JumpInterval <= 0 || Now < Fighter.NextJumpTime || !Pawn.GetGroundEntity())
	{
		return;
	}
	const Velocity: FVector = Pawn.GetAbsVelocity();
	const Heading: FVector = { x: Velocity.x, y: Velocity.y, z: 0 };
	if (VectorMath.Size(Heading) < BotCombatSettings.JumpMinSpeed)
	{
		return;
	}
	// The weapon it already has out comes first: another one takes time to draw
	const Held: string | undefined = Fighter.WeaponName;
	const Ordered: string[] = Held !== undefined && Weapons.includes(Held) ? [Held, ...Weapons] : Weapons;
	const WeaponName: string | undefined = Ordered.find((Name: string): boolean =>
	{
		const Shot: FBotShot | undefined = Definition.GetBotShot(Name);
		return Shot !== undefined && Shot.SelfPush > 0;
	});
	const Shot: FBotShot | undefined = WeaponName !== undefined ? Definition.GetBotShot(WeaponName) : undefined;
	if (WeaponName === undefined || !Shot)
	{
		return;
	}
	Fighter.NextJumpTime = Now + BotJumpRetryInterval;
	if (Shot.BlastRadius > 0 && Pawn.GetHealth() < Pawn.GetMaxHealth() * BotCombatSettings.JumpMinHealth)
	{
		return;
	}

	const Direction: FVector = VectorMath.GetSafeNormal(Heading);
	const Start: FVector = VectorMath.Add(Pawn.GetAbsOrigin(), { x: 0, y: 0, z: RoamStepHeight });
	const Ahead: FVector = VectorMath.Add(Start, VectorMath.Scale(Direction, BotCombatSettings.JumpClearDistance));
	if (Instance.TracePlayer({ start: Start, end: Ahead, player: Pawn }).didHit)
	{
		return;
	}
	const Landing: TraceResult = Instance.TraceLine({ start: Ahead, end: VectorMath.Subtract(Ahead, { x: 0, y: 0, z: BotCombatSettings.JumpLandDrop }), ignorePlayers: true });
	if (!Landing.didHit)
	{
		return;
	}

	Fighter.NextJumpTime = Now + Personality.JumpInterval * (0.5 + Math.random());
	Fighter.JumpUntil = Now + BotCombatSettings.JumpHoldTime;
	Fighter.JumpYaw = VectorMath.GetRotation(Direction).yaw;
	Fighter.JumpWeaponName = WeaponName;
	Pawn.Teleport({ velocity: { x: Velocity.x, y: Velocity.y, z: BotCombatSettings.JumpSpeed } });
}

// Mid-jump: fires down and behind, so the blast or the recoil throws it up and onwards. Its real view isn't turned.
function TickBotJump(Pawn: CSPlayerPawn, Slot: number, Now: number, Definition: PlayerClass<FClassSettings>, Fighter: FBotFighter): boolean
{
	if (Now >= Fighter.JumpUntil)
	{
		return false;
	}
	const Shot: FBotShot | undefined = Definition.GetBotShot(Fighter.JumpWeaponName);
	const Weapon: CSWeaponBase | undefined = Pawn.FindWeapon(Fighter.JumpWeaponName);
	if (!Shot || !Weapon)
	{
		Fighter.JumpUntil = 0;
		return false;
	}
	DrawBotWeapon(Pawn, Fighter, Weapon, Now);
	const Pitch: number = Shot.BlastRadius > 0 ? BotCombatSettings.JumpBlastPitch : BotCombatSettings.JumpRecoilPitch;
	const Launcher: FLauncherSettings | undefined = GetBotLauncher(Definition, Fighter.JumpWeaponName);
	Fighter.bTap = !Fighter.bTap;
	const bFire: boolean = !Launcher || !Launcher.bFireOnRelease || Fighter.bTap;
	ControlBot(Slot, bFire ? CSInputs.ATTACK : 0, Weapon, { pitch: Pitch, yaw: Fighter.JumpYaw + 180, roll: 0 });
	return true;
}

// Stabbing ////////////////////////////////////////////////////////////////////////////////////////

// Knife out, it makes for the spot behind its target's back and faces them. The swinging is left to the game's own bot.
function TickBotStab(Pawn: CSPlayerPawn, Slot: number, Now: number, Fighter: FBotFighter, Target: CSPlayerPawn): boolean
{
	const Knife: CSWeaponBase | undefined = Pawn.FindWeaponBySlot(CSGearSlot.KNIFE);
	if (!Knife)
	{
		return false;
	}
	const Origin: FVector = Pawn.GetAbsOrigin();
	const TargetOrigin: FVector = Target.GetAbsOrigin();
	const TargetFacing: FVector = VectorMath.GetForwardVector({ pitch: 0, yaw: Target.GetEyeAngles().yaw, roll: 0 });
	const Goal: FVector = VectorMath.Subtract(TargetOrigin, VectorMath.Scale(TargetFacing, BotCombatSettings.StabBehindDistance));
	if (VectorMath.Size(VectorMath.Subtract(Goal, Origin)) > BotCombatSettings.StabArriveDistance && Pawn.GetGroundEntity())
	{
		SteerBot(Pawn, Now, Fighter, Goal);
	}
	const Aim: FRotator = VectorMath.GetRotation(VectorMath.Subtract(GetChestPosition(Target), Pawn.GetEyePosition()));
	Pawn.SetEyeAngles(Aim);
	DrawBotWeapon(Pawn, Fighter, Knife, Now);
	Fighter.NextCampCheckTime = Now + BotCombatSettings.CampCheckInterval;
	Fighter.CampSpot = Origin;

	ControlBot(Slot, 0, Knife, Aim);
	return true;
}

// Nothing worth shooting or building: it counts as holding its gun, but the game's AI is left to what is really in its hands
function IdleBot(Pawn: CSPlayerPawn, Slot: number, Fighter: FBotFighter, Weapons: string[]): void
{
	const WeaponName: string | undefined = Fighter.WeaponName ?? Weapons[0];
	ControlBot(Slot, 0, WeaponName !== undefined ? Pawn.FindWeapon(WeaponName) : undefined, Pawn.GetEyeAngles());
}

// Gets a bot that has hung about one spot (or an aggressive one, always) walking towards the nearest enemy
function RoamBot(Pawn: CSPlayerPawn, Now: number, Fighter: FBotFighter, Personality: FBotPersonality): void
{
	const Origin: FVector = Pawn.GetAbsOrigin();
	if (Now >= Fighter.NextCampCheckTime)
	{
		if (VectorMath.Size(VectorMath.Subtract(Origin, Fighter.CampSpot)) < BotCombatSettings.CampRadius)
		{
			Fighter.RoamUntil = Now + BotCombatSettings.RoamTime;
		}
		Fighter.CampSpot = Origin;
		Fighter.NextCampCheckTime = Now + BotCombatSettings.CampCheckInterval;
	}
	if ((!Personality.bHunts && Now >= Fighter.RoamUntil) || !Pawn.GetGroundEntity())
	{
		return;
	}

	const Goal: FVector | undefined = FindNearestEnemySpot(Pawn);
	if (Goal)
	{
		SteerBot(Pawn, Now, Fighter, Goal);
	}
}

function SteerBot(Pawn: CSPlayerPawn, Now: number, Fighter: FBotFighter, Goal: FVector): void
{
	if (Now >= Fighter.NextSteerTime)
	{
		Fighter.NextSteerTime = Now + BotCombatSettings.RoamSteerInterval;
		Fighter.RoamYaw = FindOpenYaw(Pawn, VectorMath.GetRotation(VectorMath.Subtract(Goal, Pawn.GetAbsOrigin())).yaw);
	}
	const Direction: FVector = VectorMath.GetForwardVector({ pitch: 0, yaw: Fighter.RoamYaw, roll: 0 });
	Pawn.Teleport({ velocity: { x: Direction.x * BotCombatSettings.RoamSpeed, y: Direction.y * BotCombatSettings.RoamSpeed, z: Pawn.GetAbsVelocity().z } });
}

// Healing /////////////////////////////////////////////////////////////////////////////////////////

function TickBotHealer(Pawn: CSPlayerPawn, Slot: number, Now: number, Definition: PlayerClass<FClassSettings>, Fighter: FBotFighter): boolean
{
	GBotHealers.set(Slot, Now);
	const Tool: CSWeaponBase | undefined = Pawn.FindWeaponBySlot(CSGearSlot.KNIFE);
	const Patient: CSPlayerPawn | undefined = FindBotPatient(Pawn, Now, Fighter);
	Fighter.Patient = Patient;
	if (!Tool || !Patient)
	{
		return false;
	}

	const Eye: FVector = Pawn.GetEyePosition();
	const Offset: FVector = VectorMath.Subtract(GetChestPosition(Patient), Eye);
	if (VectorMath.Size(Offset) > BotCombatSettings.HealFollowDistance && Pawn.GetGroundEntity())
	{
		SteerBot(Pawn, Now, Fighter, Patient.GetAbsOrigin());
	}
	const Aim: FRotator = VectorMath.GetRotation(Offset);
	Pawn.SetEyeAngles(Aim);
	DrawBotWeapon(Pawn, Fighter, Tool, Now);

	// Its charge (the class's HUD counter) is used as soon as it is full and the patient has been hurt
	const Charge: FHudCounter | undefined = Definition.GetHudCounter(Slot);
	const bUseCharge: boolean = Charge !== undefined && Charge.Max > 0 && Charge.Count >= Charge.Max && Patient.GetHealth() < Patient.GetMaxHealth();
	ControlBot(Slot, CSInputs.ATTACK | (bUseCharge ? CSInputs.ATTACK2 : 0), Tool, Aim);
	return true;
}

function IsBotHealer(Pawn: CSPlayerPawn, Now: number): boolean
{
	return Now - (GBotHealers.get(GetPlayerSlot(Pawn)) ?? -Infinity) < BotRespawnGap;
}

function FindBotPatient(Pawn: CSPlayerPawn, Now: number, Fighter: FBotFighter): CSPlayerPawn | undefined
{
	const Origin: FVector = Pawn.GetAbsOrigin();
	const Current: CSPlayerPawn | undefined = Fighter.Patient;
	if (Current && Current.IsValid() && Current.IsAlive() && IsTeammate(Current, Pawn) && !IsBotHealer(Current, Now) && VectorMath.Size(VectorMath.Subtract(Current.GetAbsOrigin(), Origin)) <= BotCombatSettings.HealLeashRange)
	{
		return Current;
	}
	let Best: CSPlayerPawn | undefined = undefined;
	let BestHealth: number = Infinity;
	let BestDistance: number = Infinity;
	ForEachLivePawn((Other: CSPlayerPawn): void =>
	{
		if (Other === Pawn || !IsTeammate(Other, Pawn) || IsBotHealer(Other, Now))
		{
			return;
		}
		const Distance: number = VectorMath.Size(VectorMath.Subtract(Other.GetAbsOrigin(), Origin));
		const Health: number = Math.min(1, Other.GetHealth() / Math.max(1, Other.GetMaxHealth()));
		if (Distance <= BotCombatSettings.HealLeashRange && (Health < BestHealth || (Health === BestHealth && Distance < BestDistance)))
		{
			Best = Other;
			BestHealth = Health;
			BestDistance = Distance;
		}
	});
	return Best;
}

function FindNearestEnemySpot(Pawn: CSPlayerPawn): FVector | undefined
{
	const Origin: FVector = Pawn.GetAbsOrigin();
	let Best: FVector | undefined = undefined;
	let BestDistance: number = Infinity;
	ForEachLivePawn((Other: CSPlayerPawn): void =>
	{
		if (Other === Pawn || IsTeammate(Other, Pawn))
		{
			return;
		}
		const Spot: FVector = Other.GetAbsOrigin();
		const Distance: number = VectorMath.Size(VectorMath.Subtract(Spot, Origin));
		if (Distance < BestDistance)
		{
			Best = Spot;
			BestDistance = Distance;
		}
	});
	return Best;
}

// The way nearest to the wanted one that the bot can walk a few steps along
function FindOpenYaw(Pawn: CSPlayerPawn, WantedYaw: number): number
{
	const Start: FVector = VectorMath.Add(Pawn.GetAbsOrigin(), { x: 0, y: 0, z: RoamStepHeight });
	for (const Turn of RoamTurns)
	{
		const Direction: FVector = VectorMath.GetForwardVector({ pitch: 0, yaw: WantedYaw + Turn, roll: 0 });
		const Probe: PlayerTraceResult = Instance.TracePlayer({ start: Start, end: VectorMath.Add(Start, VectorMath.Scale(Direction, BotCombatSettings.RoamProbe)), player: Pawn });
		if (!Probe.didHit)
		{
			return WantedYaw + Turn;
		}
	}
	return WantedYaw;
}

export function ForgetBotCombat(Slot: number): void
{
	GBotFighters.delete(Slot);
	GBotPersonalities.delete(Slot);
	GBotHealers.delete(Slot);
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
		const Offset: FVector = VectorMath.Subtract(Pick.Feet, Pawn.GetAbsOrigin());
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

// The enemy (or enemy turret) in sight it expects to hurt the most, and the weapon to do it with
function FindBotTarget(Pawn: CSPlayerPawn, Fighter: FBotFighter, Definition: PlayerClass<FClassSettings>, Weapons: string[], Personality: FBotPersonality): FBotPick | undefined
{
	const Eye: FVector = Pawn.GetEyePosition();
	const Facing: FVector = VectorMath.GetForwardVector(Pawn.GetEyeAngles());
	const MinFacing: number = Math.cos((BotCombatSettings.ViewCone * Math.PI) / 180);
	let Best: FBotPick | undefined = undefined;
	const Consider = (Target: CSPlayerPawn | FBuilding, Spot: FVector, Velocity: FVector, Feet: FVector, Size: number): void =>
	{
		const Offset: FVector = VectorMath.Subtract(Spot, Eye);
		const Distance: number = VectorMath.Size(Offset);
		if (Distance >= BotCombatSettings.SightRange || (Target !== Fighter.Target && VectorMath.Dot(VectorMath.GetSafeNormal(Offset), Facing) < MinFacing))
		{
			return;
		}
		// A building's own model may be what stops the line
		const Sight: TraceResult = Instance.TraceLine({ start: Eye, end: Spot, ignorePlayers: true });
		if (Sight.didHit && !Sight.startedInSolid && VectorMath.Size(VectorMath.Subtract(Sight.end, Spot)) > Size)
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
				Best = { Target: Target, Spot: Spot, Velocity: Velocity, Feet: Feet, WeaponName: WeaponName, Rating: Rating, Distance: Distance };
			}
		}
	};
	ForEachLivePawn((Other: CSPlayerPawn): void =>
	{
		if (Other !== Pawn && !IsTeammate(Other, Pawn))
		{
			Consider(Other, GetChestPosition(Other), Other.GetAbsVelocity(), Other.GetAbsOrigin(), 0);
		}
	});
	for (const Building of GetEnemyBuildings(Pawn))
	{
		if (Building.Kind.IsBotTarget())
		{
			Consider(Building, GetBuildingCenter(Building), ZeroVector, Building.Position, Building.Kind.Settings.HalfWidth * 2 + Building.Kind.Settings.Height / 2);
		}
	}
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
	const AimPoint: FVector = GetAimPoint(Eye, Pick.Spot, Pick.Velocity, Definition.GetBallistics(Pick.WeaponName));
	const Direct: FRotator = VectorMath.GetRotation(VectorMath.Subtract(AimPoint, Eye));
	const Aim: FRotator = { pitch: Direct.pitch + Fighter.Error.pitch, yaw: Direct.yaw + Fighter.Error.yaw, roll: 0 };
	Pawn.SetEyeAngles(Aim);

	// A weapon that fires when its key comes back up is tapped; anything else is held down
	const Launcher: FLauncherSettings | undefined = GetBotLauncher(Definition, Pick.WeaponName);
	Fighter.bTap = !Fighter.bTap;
	const bReacted: boolean = Now - Fighter.SeenAt >= BotCombatSettings.ReactionTime * Personality.ReactionScale;
	const bFire: boolean = bReacted && (!Launcher || !Launcher.bFireOnRelease || Fighter.bTap);
	ControlBot(Slot, bFire ? CSInputs.ATTACK : 0, Weapon, Aim);
}

// Building ////////////////////////////////////////////////////////////////////////////////////////

// With its build tool out, taps a build key to start a building and again to put it down, throwing it somewhere else when the spot is no good
function TickBotBuilding(Pawn: CSPlayerPawn, Slot: number, Now: number, Definition: PlayerClass<FClassSettings>, Fighter: FBotFighter, Tool: CSWeaponBase): boolean
{
	ControlBot(Slot, 0, Tool, Fighter.BuildAim);
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
	ControlBot(Slot, bBlocked ? 0 : Job.Input, Tool, Fighter.BuildAim);
	return true;
}

// What a build key would build right now, if this is the place for it
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

// Where it last saw an enemy, if that was lately and close by
function GetBotEnemySpot(Pawn: CSPlayerPawn, Now: number, Fighter: FBotFighter): FVector | undefined
{
	const Spot: FVector | undefined = Fighter.EnemySpot;
	const bKnown: boolean = Spot !== undefined && Now - Fighter.EnemySeenAt <= BotCombatSettings.BuildEnemyMemory
		&& VectorMath.Size(VectorMath.Subtract(Spot, Pawn.GetAbsOrigin())) <= BotCombatSettings.BuildEnemyRange;
	return bKnown ? Spot : undefined;
}

// Turrets and traps are thrown towards the enemy, a teleporter exit onwards from its spawn, an entrance anywhere
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