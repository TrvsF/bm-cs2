import { Instance, CSDamageFlags } from "cs_script/point_script";
import type { Entity, CSPlayerPawn } from "cs_script/point_script";
import { bDebug, LogPrefix, TickInterval, ETeam, VectorMath, RotationMath, GetPlayerSlot, ForEachLivePawn } from "./bm_core";
import type { FVector, FRotator, FRotationMatrix, FColor } from "./bm_core";
import { GameMode } from "./bm_gamemode";
import { ShowPayload } from "./bm_ui";

// Payload: Ts push a cart along a track to the end, CTs stop them. Built in Hammer from named entities:
//   payload_cart         the cart (a prop_dynamic, Not Solid). The script moves it, keeping how you turned it.
//   payload_path_1, _2.. points along the track, in order (info_target or path_track). The cart starts on the first.
//                        Put "checkpoint" in a point's name (payload_path_6_checkpoint) to make it a checkpoint.
// Teams as in the base game: no friendly fire, and bots play normally. Only runs on maps with a cart and 2+ path points.

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FPayloadSettings
{
	readonly CartName: string;
	readonly PathPrefix: string;
	readonly CheckpointTag: string;
	readonly PushRadius: number;
	readonly PushHeightBelow: number;
	readonly PushHeightAbove: number;
	readonly PushSpeed: number;
	readonly MaxPushers: number;
	readonly RollbackDelay: number;
	readonly RollbackSpeed: number;
	readonly RoundTime: number;
	readonly CheckpointBonusTime: number;
	readonly PusherHealPerSecond: number;
	readonly TurnBlendDistance: number;
}

export interface FPayloadStatus
{
	readonly Progress: number;
	readonly Pushers: number;
	readonly bBlocked: boolean;
	readonly bRollingBack: boolean;
	readonly bOvertime: boolean;
	readonly bDelivered: boolean;
	readonly CheckpointsReached: number;
	readonly CheckpointFractions: readonly number[];
}

interface FPayloadTrack
{
	readonly Points: readonly FVector[];
	readonly Distances: readonly number[];
	readonly Directions: readonly FVector[];
	readonly Length: number;
	readonly Checkpoints: readonly number[];
}

interface FPayloadCart
{
	readonly Entity: Entity;
	readonly LocalRotation: FRotationMatrix;
}

interface FCartCrowd
{
	readonly Attackers: CSPlayerPawn[];
	readonly Defenders: number;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

export const PayloadSettings: FPayloadSettings =
{
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
};

const AttackingTeam: ETeam = ETeam.Terrorist;
const DefendingTeam: ETeam = ETeam.CounterTerrorist;
const PathPointClasses: readonly string[] = ["info_target", "path_track"];
const CartClasses: readonly string[] = ["prop_dynamic", "prop_dynamic_override"];
const RescanInterval: number = 1;
const WinEliminationDelay: number = 0.2;
const WinEliminationTimeout: number = 3;
const TrackDebugColor: FColor = { r: 240, g: 200, b: 60 };
const CheckpointDebugColor: FColor = { r: 120, g: 230, b: 120 };
const CartDebugColor: FColor = { r: 220, g: 60, b: 50 };

let GTrack: FPayloadTrack | undefined = undefined;
let GCart: FPayloadCart | undefined = undefined;
let GDistance: number = 0;
let GSavedDistance: number = 0;
let GCheckpointsReached: number = 0;
let GLastAttendedTime: number = 0;
let GbRoundTimerSet: boolean = false;
let GbRoundOver: boolean = false;
let GbDelivered: boolean = false;
let GNextScanTime: number = 0;
let GStatus: FPayloadStatus | undefined = undefined;
let GPendingWinner: ETeam | undefined = undefined;
let GWinStartedAt: number = 0;
let GbWinFellBack: boolean = false;
let GLastScanReport: string = "";
const GHealAccumulators: Map<number, number> = new Map<number, number>();

// Payload /////////////////////////////////////////////////////////////////////////////////////////

export class PayloadMode extends GameMode
{
	public override readonly DisplayName: string = "Payload";

	public override IsMapSetUp(): boolean
	{
		ScanPayload();
		return IsPayloadReady();
	}

	public override IsFriendlyFire(): boolean
	{
		return false;
	}

	public override GetMatchCommands(): string[]
	{
		const Minutes: number = PayloadSettings.RoundTime / 60;
		return [
			"mp_ignore_round_win_conditions 1",
			"mp_respawn_on_death_t 1",
			"mp_respawn_on_death_ct 1",
			`mp_roundtime ${Minutes}`,
			`mp_roundtime_defuse ${Minutes}`,
			`mp_roundtime_hostage ${Minutes}`,
			"bot_stop 0",
		];
	}

	public override OnActivated(): void
	{
		PlaceCart(true);
	}

	public override OnDeactivated(): void
	{
		for (const Controller of Instance.GetAllPlayerControllers())
		{
			ShowPayload(Controller.GetPlayerSlot(), undefined);
		}
	}

	public override OnRoundStart(): void
	{
		ScanPayload();
		GDistance = 0;
		GSavedDistance = 0;
		GCheckpointsReached = 0;
		GbRoundTimerSet = false;
		GbRoundOver = false;
		GbDelivered = false;
		GPendingWinner = undefined;
		GHealAccumulators.clear();
		GStatus = undefined;
		PlaceCart(true);
	}

	public override OnRoundEnd(): void
	{
		GbRoundOver = true;
		GPendingWinner = undefined;
	}

	public override Tick(Now: number, DeltaTime: number): void
	{
		TickPayload(Now, DeltaTime);
	}

	public override TickPlayerHud(Pawn: CSPlayerPawn, Slot: number): void
	{
		ShowPayload(Slot, IsPayloadReady() ? GStatus : undefined);
	}
}

function IsPayloadReady(): boolean
{
	return GTrack !== undefined && GCart !== undefined && GCart.Entity.IsValid();
}

function TickPayload(Now: number, DeltaTime: number): void
{
	if (!IsPayloadReady() && Now >= GNextScanTime)
	{
		GNextScanTime = Now + RescanInterval;
		ScanPayload();
		PlaceCart(true);
	}
	const Track: FPayloadTrack | undefined = GTrack;
	if (!Track || !IsPayloadReady())
	{
		return;
	}
	if (bDebug)
	{
		DrawTrack(Track);
	}
	if (GPendingWinner !== undefined)
	{
		TickPendingWin(GPendingWinner, Now);
	}
	if (GbRoundOver || Instance.IsWarmupPeriod() || Instance.IsFreezePeriod())
	{
		GStatus = MakeStatus(Track, 0, false, false, false, Now);
		return;
	}
	if (!GbRoundTimerSet)
	{
		GbRoundTimerSet = true;
		GLastAttendedTime = Now;
		Instance.SetRoundRemainingTime(PayloadSettings.RoundTime);
	}

	const Crowd: FCartCrowd = FindCartCrowd(GetTrackPosition(Track, GDistance));
	const Pushers: number = Math.min(Crowd.Attackers.length, PayloadSettings.MaxPushers);
	const bBlocked: boolean = Crowd.Attackers.length > 0 && Crowd.Defenders > 0;
	if (Crowd.Attackers.length > 0)
	{
		GLastAttendedTime = Now;
	}
	HealPushers(Crowd.Attackers, DeltaTime);

	let bRollingBack: boolean = false;
	if (Pushers > 0 && !bBlocked)
	{
		GDistance = Math.min(Track.Length, GDistance + PayloadSettings.PushSpeed * GetPushMultiplier(Pushers) * DeltaTime);
	}
	else if (Crowd.Attackers.length === 0 && PayloadSettings.RollbackDelay > 0 && Now - GLastAttendedTime >= PayloadSettings.RollbackDelay && GDistance > GSavedDistance)
	{
		GDistance = Math.max(GSavedDistance, GDistance - PayloadSettings.RollbackSpeed * DeltaTime);
		bRollingBack = true;
	}
	ReachCheckpoints(Track, Now);
	PlaceCart(false);

	const bTimeUp: boolean = Instance.GetRoundRemainingTime() <= 0;
	if (GDistance >= Track.Length)
	{
		GbDelivered = true;
		EndRound(AttackingTeam, Now);
	}
	else if (bTimeUp && Crowd.Attackers.length === 0)
	{
		EndRound(DefendingTeam, Now);
	}
	GStatus = MakeStatus(Track, Pushers, bBlocked && !GbRoundOver, bRollingBack, bTimeUp && !GbRoundOver, Now);
}

function GetPushMultiplier(Pushers: number): number
{
	let Multiplier: number = 0;
	for (let Pusher: number = 1; Pusher <= Pushers; Pusher++)
	{
		Multiplier += 1 / Pusher;
	}
	return Multiplier;
}

function FindCartCrowd(CartPosition: FVector): FCartCrowd
{
	const Attackers: CSPlayerPawn[] = [];
	let Defenders: number = 0;
	ForEachLivePawn((Pawn: CSPlayerPawn): void =>
	{
		const Feet: FVector = Pawn.GetAbsOrigin();
		const FlatDistance: number = Math.hypot(Feet.x - CartPosition.x, Feet.y - CartPosition.y);
		const Height: number = Feet.z - CartPosition.z;
		if (FlatDistance > PayloadSettings.PushRadius || Height < -PayloadSettings.PushHeightBelow || Height > PayloadSettings.PushHeightAbove)
		{
			return;
		}
		const Team: number = Pawn.GetTeamNumber();
		if (Team === AttackingTeam)
		{
			Attackers.push(Pawn);
		}
		else if (Team === DefendingTeam)
		{
			Defenders++;
		}
	});
	return { Attackers: Attackers, Defenders: Defenders };
}

// The cart heals the Ts near it, like a TF2 dispenser. Never past max health.
function HealPushers(Attackers: CSPlayerPawn[], DeltaTime: number): void
{
	if (PayloadSettings.PusherHealPerSecond <= 0)
	{
		return;
	}
	for (const Pawn of Attackers)
	{
		const Slot: number = GetPlayerSlot(Pawn);
		const MaxHealth: number = Pawn.GetMaxHealth();
		const Health: number = Pawn.GetHealth();
		if (Health >= MaxHealth)
		{
			GHealAccumulators.delete(Slot);
			continue;
		}
		const Accumulated: number = (GHealAccumulators.get(Slot) ?? 0) + PayloadSettings.PusherHealPerSecond * DeltaTime;
		const WholeHealth: number = Math.floor(Accumulated);
		GHealAccumulators.set(Slot, Accumulated - WholeHealth);
		if (WholeHealth > 0)
		{
			Pawn.SetHealth(Math.min(MaxHealth, Health + WholeHealth));
		}
	}
}

function ReachCheckpoints(Track: FPayloadTrack, Now: number): void
{
	while (GCheckpointsReached < Track.Checkpoints.length)
	{
		const CheckpointDistance: number | undefined = Track.Checkpoints[GCheckpointsReached];
		if (CheckpointDistance === undefined || GDistance < CheckpointDistance)
		{
			return;
		}
		GCheckpointsReached++;
		GSavedDistance = CheckpointDistance;
		Instance.SetRoundRemainingTime(Math.max(0, Instance.GetRoundRemainingTime()) + PayloadSettings.CheckpointBonusTime);
		Instance.Msg(`${LogPrefix} payload: checkpoint ${GCheckpointsReached} / ${Track.Checkpoints.length} reached, +${PayloadSettings.CheckpointBonusTime}s`);
	}
}

function EndRound(Winner: ETeam, Now: number): void
{
	if (GbRoundOver)
	{
		return;
	}
	GbRoundOver = true;
	GPendingWinner = Winner;
	GWinStartedAt = Now;
	GbWinFellBack = false;
	const Loser: ETeam = GetOtherTeam(Winner);
	Instance.ServerCommand("mp_ignore_round_win_conditions 0");
	Instance.ServerCommand(`mp_respawn_on_death_${Loser === ETeam.Terrorist ? "t" : "ct"} 0`);
	Instance.Msg(`${LogPrefix} payload: ${Winner === AttackingTeam ? "Ts delivered the cart" : "time's up, CTs held"}`);
}

function TickPendingWin(Winner: ETeam, Now: number): void
{
	const Elapsed: number = Now - GWinStartedAt;
	if (Elapsed < WinEliminationDelay)
	{
		return;
	}
	const Loser: ETeam = GetOtherTeam(Winner);
	ForEachLivePawn((Pawn: CSPlayerPawn): void =>
	{
		if (Pawn.GetTeamNumber() === Loser)
		{
			Pawn.TakeDamage({ damage: Pawn.GetHealth() + 1000, damageFlags: CSDamageFlags.FORCE_DEATH | CSDamageFlags.IGNORE_ARMOR });
		}
	});
	if (Elapsed > WinEliminationTimeout && !GbWinFellBack)
	{
		GbWinFellBack = true;
		Instance.SetRoundRemainingTime(0);
		Instance.Msg(`${LogPrefix} payload: the round didn't end on its own (is the losing side empty?), so the clock was run out`);
	}
}

function GetOtherTeam(Team: ETeam): ETeam
{
	return Team === ETeam.Terrorist ? ETeam.CounterTerrorist : ETeam.Terrorist;
}

function MakeStatus(Track: FPayloadTrack, Pushers: number, bBlocked: boolean, bRollingBack: boolean, bOvertime: boolean, Now: number): FPayloadStatus
{
	const Status: FPayloadStatus =
	{
		Progress: Track.Length > 0 ? GDistance / Track.Length : 0,
		Pushers: Pushers,
		bBlocked: bBlocked,
		bRollingBack: bRollingBack,
		bOvertime: bOvertime,
		bDelivered: GbDelivered,
		CheckpointsReached: GCheckpointsReached,
		CheckpointFractions: Track.Checkpoints.map((CheckpointDistance: number): number =>
		{
			return Track.Length > 0 ? CheckpointDistance / Track.Length : 0;
		}),
	};
	return Status;
}

// Track ///////////////////////////////////////////////////////////////////////////////////////////

function ScanPayload(): void
{
	const CartEntity: Entity | undefined = FindCartEntity();
	const Points: Entity[] = FindPathPoints();

	if (CartEntity && Points.length >= 2)
	{
		GTrack = BuildTrack(Points);
		if (!GCart || GCart.Entity !== CartEntity)
		{
			GCart = MakeCart(CartEntity, GTrack);
		}
	}
	else
	{
		GTrack = undefined;
		GCart = undefined;
	}

	const Report: string = IsPayloadReady() && GTrack
		? `payload on: ${GTrack.Points.length} track points, ${Math.round(GTrack.Length)}u long, ${GTrack.Checkpoints.length} checkpoints. Ts push, CTs defend, no friendly fire.`
		: CartEntity || Points.length > 0
			? `payload off: found ${CartEntity ? "a cart" : "no cart"} ("${PayloadSettings.CartName}") and ${Points.length} track points ("${PayloadSettings.PathPrefix}1" ...). It needs a cart and at least 2 points.`
			: "";
	if (Report !== "" && Report !== GLastScanReport)
	{
		Instance.Msg(`${LogPrefix} ${Report}`);
	}
	GLastScanReport = Report;
}

function FindCartEntity(): Entity | undefined
{
	const Named: Entity | undefined = Instance.FindEntitiesByName(PayloadSettings.CartName).find((Ent: Entity): boolean =>
	{
		return Ent.IsValid();
	});
	if (Named)
	{
		return Named;
	}
	for (const ClassName of CartClasses)
	{
		for (const Ent of Instance.FindEntitiesByClass(ClassName))
		{
			if (Ent.IsValid() && Ent.GetEntityName().includes(PayloadSettings.CartName))
			{
				return Ent;
			}
		}
	}
	return undefined;
}

function FindPathPoints(): Entity[]
{
	const Candidates: Set<Entity> = new Set<Entity>(Instance.FindEntitiesByName(`${PayloadSettings.PathPrefix}*`));
	for (const ClassName of PathPointClasses)
	{
		for (const Ent of Instance.FindEntitiesByClass(ClassName))
		{
			Candidates.add(Ent);
		}
	}

	const Numbered: Map<number, Entity> = new Map<number, Entity>();
	for (const Ent of Candidates)
	{
		const PathNumber: number | undefined = Ent.IsValid() ? GetPathNumber(Ent.GetEntityName()) : undefined;
		if (PathNumber !== undefined && !Numbered.has(PathNumber))
		{
			Numbered.set(PathNumber, Ent);
		}
	}
	return [...Numbered.entries()].sort((A: [number, Entity], B: [number, Entity]): number =>
	{
		return A[0] - B[0];
	}).map((Entry: [number, Entity]): Entity =>
	{
		return Entry[1];
	});
}

function GetPathNumber(Name: string): number | undefined
{
	const Lower: string = Name.toLowerCase();
	const Start: number = Lower.indexOf(PayloadSettings.PathPrefix);
	if (Start < 0)
	{
		return undefined;
	}
	const Digits: RegExpMatchArray | null = Lower.substring(Start + PayloadSettings.PathPrefix.length).match(/^\d+/);
	return Digits ? Number(Digits[0]) : undefined;
}

function BuildTrack(PointEntities: Entity[]): FPayloadTrack
{
	const Points: FVector[] = [];
	const Distances: number[] = [];
	const Directions: FVector[] = [];
	const Checkpoints: number[] = [];
	let Length: number = 0;

	for (let Index: number = 0; Index < PointEntities.length; Index++)
	{
		const Ent: Entity | undefined = PointEntities[Index];
		if (!Ent)
		{
			continue;
		}
		const Point: FVector = Ent.GetAbsOrigin();
		const Previous: FVector | undefined = Points[Points.length - 1];
		if (Previous)
		{
			const Segment: FVector = VectorMath.Subtract(Point, Previous);
			Length += VectorMath.Size(Segment);
			Directions.push(VectorMath.GetSafeNormal(Segment));
		}
		Points.push(Point);
		Distances.push(Length);

		const bInterior: boolean = Index > 0 && Index < PointEntities.length - 1;
		if (bInterior && Ent.GetEntityName().toLowerCase().includes(PayloadSettings.CheckpointTag))
		{
			Checkpoints.push(Length);
		}
	}
	return { Points: Points, Distances: Distances, Directions: Directions, Length: Length, Checkpoints: Checkpoints };
}

function MakeCart(CartEntity: Entity, Track: FPayloadTrack): FPayloadCart
{
	const FirstDirection: FVector = Track.Directions[0] ?? { x: 1, y: 0, z: 0 };
	const TrackRotation: FRotationMatrix = RotationMath.FromRotator(VectorMath.GetRotation(FirstDirection));
	const PlacedRotation: FRotationMatrix = RotationMath.FromRotator(CartEntity.GetAbsAngles());
	return { Entity: CartEntity, LocalRotation: RotationMath.Multiply(RotationMath.Inverse(TrackRotation), PlacedRotation) };
}

function GetSegmentIndex(Track: FPayloadTrack, Distance: number): number
{
	for (let Index: number = 0; Index < Track.Directions.length; Index++)
	{
		const End: number = Track.Distances[Index + 1] ?? Track.Length;
		if (Distance <= End)
		{
			return Index;
		}
	}
	return Math.max(0, Track.Directions.length - 1);
}

function GetTrackPosition(Track: FPayloadTrack, Distance: number): FVector
{
	const Index: number = GetSegmentIndex(Track, Distance);
	const Start: FVector = Track.Points[Index] ?? { x: 0, y: 0, z: 0 };
	const Direction: FVector = Track.Directions[Index] ?? { x: 1, y: 0, z: 0 };
	const Along: number = Distance - (Track.Distances[Index] ?? 0);
	return VectorMath.Add(Start, VectorMath.Scale(Direction, Along));
}

function GetTrackDirection(Track: FPayloadTrack, Distance: number): FVector
{
	const Index: number = GetSegmentIndex(Track, Distance);
	const Direction: FVector = Track.Directions[Index] ?? { x: 1, y: 0, z: 0 };
	const SegmentStart: number = Track.Distances[Index] ?? 0;
	const SegmentEnd: number = Track.Distances[Index + 1] ?? Track.Length;
	const Blend: number = Math.min(PayloadSettings.TurnBlendDistance, (SegmentEnd - SegmentStart) / 2);
	if (Blend <= 0)
	{
		return Direction;
	}

	const Previous: FVector | undefined = Track.Directions[Index - 1];
	const Next: FVector | undefined = Track.Directions[Index + 1];
	const IntoSegment: number = Distance - SegmentStart;
	const LeftInSegment: number = SegmentEnd - Distance;
	if (Previous && IntoSegment < Blend)
	{
		return BlendDirections(Previous, Direction, (IntoSegment + Blend) / (2 * Blend));
	}
	if (Next && LeftInSegment < Blend)
	{
		return BlendDirections(Direction, Next, (Blend - LeftInSegment) / (2 * Blend));
	}
	return Direction;
}

function BlendDirections(From: FVector, To: FVector, Alpha: number): FVector
{
	return VectorMath.GetSafeNormal(VectorMath.Add(VectorMath.Scale(From, 1 - Alpha), VectorMath.Scale(To, Alpha)));
}

function PlaceCart(bTeleport: boolean): void
{
	const Track: FPayloadTrack | undefined = GTrack;
	const Cart: FPayloadCart | undefined = GCart;
	if (!Track || !Cart || !Cart.Entity.IsValid())
	{
		return;
	}
	const Position: FVector = GetTrackPosition(Track, GDistance);
	const TrackRotation: FRotationMatrix = RotationMath.FromRotator(VectorMath.GetRotation(GetTrackDirection(Track, GDistance)));
	const Angles: FRotator = RotationMath.ToRotator(RotationMath.Multiply(TrackRotation, Cart.LocalRotation));
	if (bTeleport)
	{
		Cart.Entity.Teleport({ position: Position, angles: Angles });
	}
	else
	{
		Cart.Entity.Move({ position: Position, angles: Angles });
	}
}

function DrawTrack(Track: FPayloadTrack): void
{
	for (let Index: number = 1; Index < Track.Points.length; Index++)
	{
		const From: FVector | undefined = Track.Points[Index - 1];
		const To: FVector | undefined = Track.Points[Index];
		if (From && To)
		{
			Instance.DebugLine({ start: From, end: To, duration: TickInterval * 2, color: TrackDebugColor });
		}
	}
	for (const CheckpointDistance of Track.Checkpoints)
	{
		Instance.DebugSphere({ center: GetTrackPosition(Track, CheckpointDistance), radius: 16, duration: TickInterval * 2, color: CheckpointDebugColor });
	}
	Instance.DebugSphere({ center: GetTrackPosition(Track, GDistance), radius: PayloadSettings.PushRadius, duration: TickInterval * 2, color: CartDebugColor });
}