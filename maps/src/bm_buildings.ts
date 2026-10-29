import { Instance, Console } from "cs_script/point_script";
import type { Entity, CSPlayerPawn, TraceResult } from "cs_script/point_script";
import { TickInterval, LogPrefix, VectorMath, RotationMath, IsFriendlyFire, IsModelEntity, GetPawnName, GetPlayerSlot, GetColorForTeam, GetOrCreate, SpawnTemplateEntities, INDEX_NONE } from "./bm_core";
import type { FVector, FRotator, FRotationMatrix, FColor } from "./bm_core";
import { SpawnTemporaryTemplate } from "./bm_effects";
import { ShowDamageNumber } from "./bm_hud";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FBuildingSettings
{
	readonly DisplayName: string;
	readonly ModelTemplate: string;
	readonly PreviewTemplate: string;
	readonly DestroyFxTemplate: string;
	readonly Health: number;
	readonly HalfWidth: number;
	readonly Height: number;
	readonly ThrowSpeed: number;
	readonly MaxCount: number;
	readonly RebuildDelay: number;
}

export interface FBuildingModel
{
	readonly Ent: Entity;
	readonly LocalRotation: FRotationMatrix;
}

export interface FBuilding
{
	readonly Kind: BuildingKind;
	readonly Owner: CSPlayerPawn;
	readonly OwnerSlot: number;
	readonly Team: number;
	readonly Position: FVector;
	Yaw: number;
	Health: number;
	DamageDealt: number;
	Models: FBuildingModel[];
	ColorKey: string;
	bRemoved: boolean;
}

export interface FBuildingHit
{
	readonly Building: FBuilding;
	readonly Fraction: number;
	readonly Point: FVector;
	readonly Normal: FVector;
}

export interface FBuildingHudRow
{
	readonly Name: string;
	readonly Health: number;
	readonly MaxHealth: number;
	readonly Status: string;
}

export enum EBuildHint
{
	Ready = "Ready",
	Placing = "Placing",
	Blocked = "Blocked",
	Full = "Full",
	Cooldown = "Cooldown",
}

export interface FBuildKey
{
	readonly Label: string;
	readonly Kinds: readonly BuildingKind[];
}

// What each mouse button builds while a class's build tool is out
export interface FBuildKeys
{
	readonly Left: FBuildKey;
	readonly Right: FBuildKey;
}

export interface FBuildHint
{
	readonly Name: string;
	readonly Detail: string;
	readonly State: EBuildHint;
}

export interface FBuildHints
{
	readonly Left: FBuildHint;
	readonly Right: FBuildHint;
}

interface FPlacement
{
	readonly Kind: BuildingKind;
	readonly Owner: CSPlayerPawn;
	readonly Carried: FBuilding | undefined;
	readonly Preview: FBuildingModel[];
	Path: FVector[];
	Position: FVector;
	Yaw: number;
	bValid: boolean;
}

interface FBoxHit
{
	readonly Fraction: number;
	readonly Normal: FVector;
}

export abstract class BuildingKind<TSettings extends FBuildingSettings = FBuildingSettings>
{
	public readonly Settings: TSettings;

	constructor(Settings: TSettings)
	{
		this.Settings = Settings;
	}

	public OnPlaced(Building: FBuilding, Now: number): void
	{
	}

	public Tick(Building: FBuilding, Now: number, DeltaTime: number): void
	{
	}

	// Taken away for any reason: destroyed, picked up, its owner changing class...
	public OnRemoved(Building: FBuilding): void
	{
	}

	// Only when it's broken (or its owner dies), after it's been removed
	public OnDestroyed(Building: FBuilding): void
	{
	}

	// Tints its model and debug box while set, e.g. a teleporter recharging. undefined = its team's colour.
	public GetColor(Building: FBuilding, Now: number): FColor | undefined
	{
		return undefined;
	}

	// A word or two for the owner's building panel
	public GetStatus(Building: FBuilding, Now: number): string
	{
		return "";
	}
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const Axes: readonly ("x" | "y" | "z")[] = ["x", "y", "z"];
const PlacementGravity: number = 800;
const PlacementStepTime: number = 1 / 32;
const MaxPlacementSteps: number = 96;
const MaxPlacementSlopeDegrees: number = 45;
const MinGroundNormalZ: number = Math.cos((MaxPlacementSlopeDegrees * Math.PI) / 180);
const PlacementLift: number = 2;
const PickUpRange: number = 150;
const MeleeReach: number = 80;
const MeleeRadius: number = 8;
const RepairBuildLockout: number = 1;
const DestroyFxLifetime: number = 5;
const ValidPlacementColor: FColor = { r: 90, g: 230, b: 120 };
const BlockedPlacementColor: FColor = { r: 255, g: 190, b: 40 };
const DestroyedDebugColor: FColor = { r: 255, g: 140, b: 0 };

let GBuildings: FBuilding[] = [];
const GPlacements: Map<number, FPlacement> = new Map<number, FPlacement>();
const GBuildingTraces: WeakMap<TraceResult, FBuilding> = new WeakMap<TraceResult, FBuilding>();
const GRebuildTimes: Map<number, Map<BuildingKind, number>> = new Map<number, Map<BuildingKind, number>>();
const GLastRepairTimes: Map<number, number> = new Map<number, number>();

// Buildings ///////////////////////////////////////////////////////////////////////////////////////

export function TickBuildings(Now: number, DeltaTime: number): void
{
	for (const Building of [...GBuildings])
	{
		if (Building.bRemoved)
		{
			continue;
		}
		if (!Building.Owner.IsValid())
		{
			RemoveBuilding(Building);
			continue;
		}
		Building.Kind.Tick(Building, Now, DeltaTime);
		if (!Building.bRemoved)
		{
			const Color: FColor = GetBuildingColor(Building, Now);
			TintBuilding(Building, Color);

			if (Building.Models.length === 0)
			{
				DrawBuildingBox(Building.Position, Building.Kind.Settings, Color);
			}
		}
	}
}

export function GetOwnedBuildings(Slot: number): FBuilding[]
{
	return GBuildings.filter((Building: FBuilding): boolean =>
	{
		return Building.OwnerSlot === Slot;
	});
}

export function CountOwnedBuildings(Slot: number, Kind: BuildingKind): number
{
	return GBuildings.filter((Building: FBuilding): boolean =>
	{
		return Building.OwnerSlot === Slot && Building.Kind === Kind;
	}).length;
}

export function FindOwnedBuilding(Slot: number, Kind: BuildingKind): FBuilding | undefined
{
	return GBuildings.find((Building: FBuilding): boolean =>
	{
		return Building.OwnerSlot === Slot && Building.Kind === Kind;
	});
}

export function GetOwnedBuildingEntities(Pawn: CSPlayerPawn): Entity[]
{
	const Entities: Entity[] = [];
	for (const Building of GBuildings)
	{
		if (Building.Owner === Pawn)
		{
			Entities.push(...GetModelEntities(Building.Models));
		}
	}
	return Entities;
}

export function GetBuildingEntities(Building: FBuilding): Entity[]
{
	return GetModelEntities(Building.Models);
}

export function GetBuildingCenter(Building: FBuilding): FVector
{
	return VectorMath.Add(Building.Position, { x: 0, y: 0, z: Building.Kind.Settings.Height / 2 });
}

export function IsBuildingEnemy(Building: FBuilding, Pawn: CSPlayerPawn): boolean
{
	return Pawn !== Building.Owner && (IsFriendlyFire() || Pawn.GetTeamNumber() !== Building.Team);
}

export function IsStandingOn(Building: FBuilding, Pawn: CSPlayerPawn, Reach: number, Above: number): boolean
{
	const Feet: FVector = Pawn.GetAbsOrigin();
	const Height: number = Feet.z - Building.Position.z;
	return Math.abs(Feet.x - Building.Position.x) <= Reach && Math.abs(Feet.y - Building.Position.y) <= Reach && Height >= -PlacementLift * 4 && Height <= Above;
}

export function TurnBuilding(Building: FBuilding, Yaw: number): void
{
	Building.Yaw = Yaw;
	PlaceModels(Building.Models, Building.Position, Yaw, false);
}

export function DamageBuilding(Building: FBuilding, Damage: number, Attacker: CSPlayerPawn | undefined): void
{
	if (Building.bRemoved || Damage <= 0)
	{
		return;
	}
	Building.Health -= Damage;
	const AttackerSlot: number = Attacker ? GetPlayerSlot(Attacker) : INDEX_NONE;
	if (AttackerSlot !== INDEX_NONE)
	{
		ShowDamageNumber(AttackerSlot, Damage);
	}
	if (Building.Health > 0)
	{
		return;
	}
	const Killer: string = Attacker ? GetPawnName(Attacker) : "something";
	Console.Log(`${LogPrefix} ${Killer} destroyed ${GetPawnName(Building.Owner)}'s ${Building.Kind.Settings.DisplayName}`);
	DestroyBuilding(Building);
}

export function RepairBuildingInReach(Pawn: CSPlayerPawn, Slot: number, Amount: number, Now: number): void
{
	const Building: FBuilding | undefined = FindFriendlyBuildingInReach(Pawn);
	if (!Building)
	{
		return;
	}
	const MaxHealth: number = Building.Kind.Settings.Health;
	const Repaired: number = Math.min(Amount, MaxHealth - Building.Health);
	if (Repaired <= 0)
	{
		if (IsInRepairLockout(Slot, Now))
		{
			GLastRepairTimes.set(Slot, Now);
		}
		return;
	}
	Building.Health += Repaired;
	GLastRepairTimes.set(Slot, Now);
	Console.Log(`${LogPrefix} ${GetPawnName(Pawn)} repaired ${GetPawnName(Building.Owner)}'s ${Building.Kind.Settings.DisplayName} (+${Math.round(Repaired)}, ${Math.round(Building.Health)}/${MaxHealth})`);
}

export function IsRepairingBuilding(Pawn: CSPlayerPawn, Slot: number, Now: number): boolean
{
	if (IsInRepairLockout(Slot, Now))
	{
		return true;
	}
	const Building: FBuilding | undefined = FindFriendlyBuildingInReach(Pawn);
	return Building !== undefined && Building.Health < Building.Kind.Settings.Health;
}

function IsInRepairLockout(Slot: number, Now: number): boolean
{
	return Now - (GLastRepairTimes.get(Slot) ?? -Infinity) < RepairBuildLockout;
}

function FindFriendlyBuildingInReach(Pawn: CSPlayerPawn): FBuilding | undefined
{
	const Eye: FVector = Pawn.GetEyePosition();
	const End: FVector = VectorMath.Add(Eye, VectorMath.Scale(VectorMath.GetForwardVector(Pawn.GetEyeAngles()), MeleeReach));
	const Team: number = Pawn.GetTeamNumber();
	const Hit: FBuildingHit | undefined = TraceBuildings(Eye, End, MeleeRadius, (Building: FBuilding): boolean =>
	{
		return !Building.bRemoved && Building.Team === Team;
	});
	if (!Hit)
	{
		return undefined;
	}
	const Sight: TraceResult = Instance.TraceLine({ start: Eye, end: Hit.Point, ignorePlayers: true, ignoreEntity: GetBuildingEntities(Hit.Building) });
	return Sight.didHit ? undefined : Hit.Building;
}

export function DestroyBuilding(Building: FBuilding): void
{
	if (Building.bRemoved)
	{
		return;
	}
	const Center: FVector = GetBuildingCenter(Building);
	const TemplateName: string = Building.Kind.Settings.DestroyFxTemplate;
	if (TemplateName === "" || !SpawnTemporaryTemplate(TemplateName, Center, DestroyFxLifetime))
	{
		Instance.DebugSphere({ center: Center, radius: Math.max(Building.Kind.Settings.Height, Building.Kind.Settings.HalfWidth), duration: 0.5, color: DestroyedDebugColor });
	}
	GetOrCreate(GRebuildTimes, Building.OwnerSlot, (): Map<BuildingKind, number> =>
	{
		return new Map<BuildingKind, number>();
	}).set(Building.Kind, Instance.GetGameTime() + Building.Kind.Settings.RebuildDelay);
	RemoveBuilding(Building);
	Building.Kind.OnDestroyed(Building);
}

export function RemoveBuilding(Building: FBuilding): void
{
	if (Building.bRemoved)
	{
		return;
	}
	Building.bRemoved = true;
	RemoveModels(Building.Models);
	Building.Models = [];
	GBuildings = GBuildings.filter((Other: FBuilding): boolean =>
	{
		return Other !== Building;
	});
	Building.Kind.OnRemoved(Building);
}

export function RemoveBuildings(Slot: number): void
{
	DropPlacement(Slot);
	for (const Building of GetOwnedBuildings(Slot))
	{
		RemoveBuilding(Building);
	}
	GRebuildTimes.delete(Slot);
}

export function ClearBuildings(): void
{
	for (const Placement of GPlacements.values())
	{
		RemoveModels(Placement.Preview);
	}
	GPlacements.clear();
	for (const Building of [...GBuildings])
	{
		RemoveBuilding(Building);
	}
	GRebuildTimes.clear();
	GLastRepairTimes.clear();
}

export function GetBuildingHudRows(Slot: number, Now: number): FBuildingHudRow[]
{
	return GetOwnedBuildings(Slot).map((Building: FBuilding): FBuildingHudRow =>
	{
		const Row: FBuildingHudRow =
		{
			Name: Building.Kind.Settings.DisplayName,
			Health: Math.max(0, Math.ceil(Building.Health)),
			MaxHealth: Building.Kind.Settings.Health,
			Status: Building.Kind.GetStatus(Building, Now),
		};
		return Row;
	});
}

function PlaceBuilding(Owner: CSPlayerPawn, Slot: number, Kind: BuildingKind, Position: FVector, Yaw: number, Health: number, Now: number): FBuilding
{
	const Building: FBuilding =
	{
		Kind: Kind,
		Owner: Owner,
		OwnerSlot: Slot,
		Team: Owner.GetTeamNumber(),
		Position: Position,
		Yaw: Yaw,
		Health: Health,
		DamageDealt: 0,
		Models: SpawnModels(Kind.Settings.ModelTemplate, Position),
		ColorKey: "",
		bRemoved: false,
	};
	PlaceModels(Building.Models, Position, Yaw, true);
	GBuildings.push(Building);
	Kind.OnPlaced(Building, Now);
	TintBuilding(Building, GetBuildingColor(Building, Now));
	return Building;
}

// Build tool //////////////////////////////////////////////////////////////////////////////////////

export function TickBuildTool(Pawn: CSPlayerPawn, Slot: number, Keys: FBuildKeys | undefined, bLeftPressed: boolean, bRightPressed: boolean, Now: number): void
{
	if (!Keys)
	{
		CancelPlacement(Slot);
		return;
	}
	if (bLeftPressed)
	{
		UseBuildKey(Pawn, Slot, Keys.Left.Kinds, Now);
	}
	else if (bRightPressed)
	{
		UseBuildKey(Pawn, Slot, Keys.Right.Kinds, Now);
	}
	TickPlacement(Slot);
}

export function GetBuildHints(Slot: number, Keys: FBuildKeys, Now: number): FBuildHints
{
	return { Left: GetBuildHint(Slot, Keys.Left, Now), Right: GetBuildHint(Slot, Keys.Right, Now) };
}

function GetBuildHint(Slot: number, Key: FBuildKey, Now: number): FBuildHint
{
	const Placement: FPlacement | undefined = GPlacements.get(Slot);
	if (Placement && Key.Kinds.includes(Placement.Kind))
	{
		return { Name: Placement.Kind.Settings.DisplayName, Detail: "", State: Placement.bValid ? EBuildHint.Placing : EBuildHint.Blocked };
	}
	const Next: BuildingKind | undefined = GetNextToBuild(Slot, Key.Kinds);
	if (!Next)
	{
		return { Name: Key.Label, Detail: "", State: EBuildHint.Full };
	}
	const Wait: number = GetRebuildWait(Slot, Next, Now);
	if (Wait > 0)
	{
		return { Name: Next.Settings.DisplayName, Detail: `${Math.ceil(Wait)}s`, State: EBuildHint.Cooldown };
	}
	const Left: number = Next.Settings.MaxCount - CountOwnedBuildings(Slot, Next);
	return { Name: Next.Settings.DisplayName, Detail: Left > 1 ? `x${Left}` : "", State: EBuildHint.Ready };
}

function GetRebuildWait(Slot: number, Kind: BuildingKind, Now: number): number
{
	return Math.max(0, (GRebuildTimes.get(Slot)?.get(Kind) ?? 0) - Now);
}

function GetNextToBuild(Slot: number, Kinds: readonly BuildingKind[]): BuildingKind | undefined
{
	return Kinds.find((Kind: BuildingKind): boolean =>
	{
		return CountOwnedBuildings(Slot, Kind) < Kind.Settings.MaxCount;
	});
}

// First press shows where it'll land, the same key again builds it there. Pressed while looking at one of your own Kinds, it picks that up instead.
function UseBuildKey(Pawn: CSPlayerPawn, Slot: number, Kinds: readonly BuildingKind[], Now: number): void
{
	const Placing: BuildingKind | undefined = GetPlacingKind(Slot);
	if (Placing && Kinds.includes(Placing))
	{
		ConfirmPlacement(Slot, Now);
		return;
	}
	if (Placing && IsCarryingBuilding(Slot))
	{
		return;
	}

	const Eye: FVector = Pawn.GetEyePosition();
	const Reach: FVector = VectorMath.Add(Eye, VectorMath.Scale(VectorMath.GetForwardVector(Pawn.GetEyeAngles()), PickUpRange));
	const InView: FBuildingHit | undefined = TraceBuildings(Eye, Reach, 0, (Building: FBuilding): boolean =>
	{
		return Building.OwnerSlot === Slot && Kinds.includes(Building.Kind);
	});
	if (InView)
	{
		PickUpBuilding(InView.Building);
		return;
	}

	const Next: BuildingKind | undefined = GetNextToBuild(Slot, Kinds);
	if (Next && GetRebuildWait(Slot, Next, Now) <= 0)
	{
		StartPlacement(Pawn, Slot, Next);
	}
}

// Placement ///////////////////////////////////////////////////////////////////////////////////////

export function GetPlacingKind(Slot: number): BuildingKind | undefined
{
	return GPlacements.get(Slot)?.Kind;
}

export function IsCarryingBuilding(Slot: number): boolean
{
	return GPlacements.get(Slot)?.Carried !== undefined;
}

export function StartPlacement(Owner: CSPlayerPawn, Slot: number, Kind: BuildingKind): void
{
	CancelPlacement(Slot);
	GPlacements.set(Slot, MakePlacement(Owner, Kind, undefined));
	TickPlacement(Slot);
}

export function PickUpBuilding(Building: FBuilding): void
{
	const Slot: number = Building.OwnerSlot;
	CancelPlacement(Slot);
	RemoveBuilding(Building);
	GPlacements.set(Slot, MakePlacement(Building.Owner, Building.Kind, Building));
	TickPlacement(Slot);
	Console.Log(`${LogPrefix} ${GetPawnName(Building.Owner)} picked up their ${Building.Kind.Settings.DisplayName}`);
}

export function TickPlacement(Slot: number): void
{
	const Placement: FPlacement | undefined = GPlacements.get(Slot);
	if (!Placement)
	{
		return;
	}
	if (!Placement.Owner.IsValid())
	{
		CancelPlacement(Slot);
		return;
	}
	UpdatePlacementSpot(Placement);
	PlaceModels(Placement.Preview, Placement.Position, Placement.Yaw, false);

	const Color: FColor = Placement.bValid ? ValidPlacementColor : BlockedPlacementColor;
	for (let Index: number = 1; Index < Placement.Path.length; Index++)
	{
		const From: FVector | undefined = Placement.Path[Index - 1];
		const To: FVector | undefined = Placement.Path[Index];
		if (From && To)
		{
			Instance.DebugLine({ start: From, end: To, duration: TickInterval * 2, color: Color });
		}
	}
	DrawBuildingBox(Placement.Position, Placement.Kind.Settings, Color);
}

export function ConfirmPlacement(Slot: number, Now: number): FBuilding | undefined
{
	const Placement: FPlacement | undefined = GPlacements.get(Slot);
	if (!Placement)
	{
		return undefined;
	}
	UpdatePlacementSpot(Placement);
	if (!Placement.bValid)
	{
		return undefined;
	}
	GPlacements.delete(Slot);
	RemoveModels(Placement.Preview);
	const Health: number = Placement.Carried ? Placement.Carried.Health : Placement.Kind.Settings.Health;
	const Building: FBuilding = PlaceBuilding(Placement.Owner, Slot, Placement.Kind, Placement.Position, Placement.Yaw, Health, Now);
	Console.Log(`${LogPrefix} ${GetPawnName(Placement.Owner)} built a ${Placement.Kind.Settings.DisplayName}`);
	return Building;
}

export function CancelPlacement(Slot: number): void
{
	const Placement: FPlacement | undefined = GPlacements.get(Slot);
	if (!Placement)
	{
		return;
	}
	GPlacements.delete(Slot);
	RemoveModels(Placement.Preview);
	const Carried: FBuilding | undefined = Placement.Carried;
	if (Carried && Carried.Owner.IsValid())
	{
		PlaceBuilding(Carried.Owner, Carried.OwnerSlot, Carried.Kind, Carried.Position, Carried.Yaw, Carried.Health, Instance.GetGameTime());
	}
}

function DropPlacement(Slot: number): void
{
	const Placement: FPlacement | undefined = GPlacements.get(Slot);
	if (Placement)
	{
		RemoveModels(Placement.Preview);
		GPlacements.delete(Slot);
	}
}

function MakePlacement(Owner: CSPlayerPawn, Kind: BuildingKind, Carried: FBuilding | undefined): FPlacement
{
	const Position: FVector = Owner.GetAbsOrigin();
	return { Kind: Kind, Owner: Owner, Carried: Carried, Preview: SpawnModels(Kind.Settings.PreviewTemplate, Position), Path: [], Position: Position, Yaw: 0, bValid: false };
}

// Thrown from the eyes along the aim, falling under gravity, until it lands on something no steeper than
// MaxPlacementSlopeDegrees. Anything steeper (a wall, a ceiling) and it drops straight down from there, far enough out to fit.
function UpdatePlacementSpot(Placement: FPlacement): void
{
	const Settings: FBuildingSettings = Placement.Kind.Settings;
	const Owner: CSPlayerPawn = Placement.Owner;
	const Aim: FRotator = Owner.GetEyeAngles();
	const Ignored: Entity[] = [Owner, ...GetModelEntities(Placement.Preview)];

	let Position: FVector = Owner.GetEyePosition();
	let Velocity: FVector = VectorMath.Scale(VectorMath.GetForwardVector(Aim), Settings.ThrowSpeed);
	let Ground: TraceResult | undefined = undefined;
	const Path: FVector[] = [Position];
	for (let Step: number = 0; Step < MaxPlacementSteps && !Ground; Step++)
	{
		Velocity = { x: Velocity.x, y: Velocity.y, z: Velocity.z - PlacementGravity * PlacementStepTime };
		const Next: FVector = VectorMath.Add(Position, VectorMath.Scale(Velocity, PlacementStepTime));
		const Trace: TraceResult = Instance.TraceLine({ start: Position, end: Next, ignoreEntity: Ignored, ignorePlayers: true });
		if (!Trace.didHit)
		{
			Position = Next;
			Path.push(Next);
			continue;
		}
		Path.push(Trace.end);
		if (!Trace.startedInSolid && Trace.normal.z >= MinGroundNormalZ)
		{
			Ground = Trace;
			break;
		}
		Position = VectorMath.Add(Trace.end, VectorMath.Scale(Trace.normal, Settings.HalfWidth + PlacementLift));
		Velocity = { x: 0, y: 0, z: Math.min(0, Velocity.z) };
	}

	Placement.Path = Path;
	Placement.Position = Ground ? Ground.end : Position;
	Placement.Yaw = Aim.yaw;
	Placement.bValid = Ground !== undefined && HasRoom(Ground.end, Ground.normal, Settings, GetModelEntities(Placement.Preview)) && !OverlapsBuilding(Ground.end, Settings);
}

// The box above the ground has to be clear of the world and players. On a slope only the part above the
// uphill corner is checked, since the ground itself fills the rest.
function HasRoom(Position: FVector, GroundNormal: FVector, Settings: FBuildingSettings, Ignored: Entity[]): boolean
{
	const SlopeRise: number = (Settings.HalfWidth * Math.SQRT2 * Math.sqrt(Math.max(0, 1 - GroundNormal.z * GroundNormal.z))) / Math.max(0.01, GroundNormal.z);
	const Lift: number = SlopeRise + PlacementLift;
	if (Lift >= Settings.Height)
	{
		return true;
	}
	const Start: FVector = VectorMath.Add(Position, { x: 0, y: 0, z: Lift });
	const Trace: TraceResult = Instance.TraceBox(
	{
		start: Start,
		end: VectorMath.Add(Start, { x: 0, y: 0, z: 1 }),
		mins: { x: -Settings.HalfWidth, y: -Settings.HalfWidth, z: 0 },
		maxs: { x: Settings.HalfWidth, y: Settings.HalfWidth, z: Settings.Height - Lift },
		ignoreEntity: Ignored,
		ignorePlayers: false,
	});
	return !Trace.didHit && !Trace.startedInSolid;
}

function OverlapsBuilding(Position: FVector, Settings: FBuildingSettings): boolean
{
	return GBuildings.some((Building: FBuilding): boolean =>
	{
		const Other: FBuildingSettings = Building.Kind.Settings;
		const Reach: number = Settings.HalfWidth + Other.HalfWidth;
		return Math.abs(Position.x - Building.Position.x) < Reach
			&& Math.abs(Position.y - Building.Position.y) < Reach
			&& Position.z < Building.Position.z + Other.Height
			&& Building.Position.z < Position.z + Settings.Height;
	});
}

// Hits ////////////////////////////////////////////////////////////////////////////////////////////

// The nearest building Filter allows whose box (grown by Radius on every side) the line from Start to End runs into
export function TraceBuildings(Start: FVector, End: FVector, Radius: number, Filter: (Building: FBuilding) => boolean): FBuildingHit | undefined
{
	let Best: FBuildingHit | undefined = undefined;
	for (const Building of GBuildings)
	{
		if (!Filter(Building))
		{
			continue;
		}
		const Settings: FBuildingSettings = Building.Kind.Settings;
		const Mins: FVector = VectorMath.Add(Building.Position, { x: -Settings.HalfWidth - Radius, y: -Settings.HalfWidth - Radius, z: -Radius });
		const Maxs: FVector = VectorMath.Add(Building.Position, { x: Settings.HalfWidth + Radius, y: Settings.HalfWidth + Radius, z: Settings.Height + Radius });
		const Hit: FBoxHit | undefined = IntersectSegmentBox(Start, End, Mins, Maxs);
		if (Hit && (!Best || Hit.Fraction < Best.Fraction))
		{
			const Point: FVector = VectorMath.Add(Start, VectorMath.Scale(VectorMath.Subtract(End, Start), Hit.Fraction));
			Best = { Building: Building, Fraction: Hit.Fraction, Point: Point, Normal: Hit.Normal };
		}
	}
	return Best;
}

// Where a line from Start to End (which Trace already followed, if given) first runs into one of Attacker's enemies' buildings
export function FindBuildingOnLine(Attacker: CSPlayerPawn, Start: FVector, End: FVector, Trace: TraceResult | undefined): FBuildingHit | undefined
{
	const Struck: FBuilding | undefined = GetTraceBuilding(Trace);
	if (Trace && Struck && IsBuildingEnemy(Struck, Attacker))
	{
		return { Building: Struck, Fraction: Trace.fraction, Point: Trace.end, Normal: Trace.normal };
	}
	return TraceBuildings(Start, End, 0, (Building: FBuilding): boolean =>
	{
		return IsBuildingEnemy(Building, Attacker);
	});
}

// A projectile's trace, cut short at any of its owner's enemies' buildings it reaches first
export function ClipTraceToBuildings(Trace: TraceResult, Start: FVector, End: FVector, Radius: number, Owner: CSPlayerPawn): TraceResult
{
	const Hit: FBuildingHit | undefined = TraceBuildings(Start, End, Radius, (Building: FBuilding): boolean =>
	{
		return IsBuildingEnemy(Building, Owner);
	});
	if (!Hit || (Trace.didHit && Trace.fraction <= Hit.Fraction))
	{
		return Trace;
	}
	const Clipped: TraceResult = { fraction: Hit.Fraction, end: Hit.Point, didHit: true, startedInSolid: false, normal: Hit.Normal };
	GBuildingTraces.set(Clipped, Hit.Building);
	return Clipped;
}

export function GetTraceBuilding(Trace: TraceResult | undefined): FBuilding | undefined
{
	if (!Trace)
	{
		return undefined;
	}
	return GBuildingTraces.get(Trace) ?? GetBuildingByEntity(Trace.hitEntity);
}

// For a projectile that hit something: damages it if it was a building the attacker is allowed to hurt
export function DamageTracedBuilding(Trace: TraceResult, Damage: number, Attacker: CSPlayerPawn): boolean
{
	const Building: FBuilding | undefined = GetTraceBuilding(Trace);
	if (!Building || !IsBuildingEnemy(Building, Attacker))
	{
		return false;
	}
	DamageBuilding(Building, Damage, Attacker);
	return true;
}

export function DamageBuildingsInRadius(Origin: FVector, Radius: number, Damage: number, Attacker: CSPlayerPawn): void
{
	for (const Building of [...GBuildings])
	{
		if (Building.bRemoved || !IsBuildingEnemy(Building, Attacker))
		{
			continue;
		}
		const Settings: FBuildingSettings = Building.Kind.Settings;
		const Nearest: FVector =
		{
			x: Math.min(Math.max(Origin.x, Building.Position.x - Settings.HalfWidth), Building.Position.x + Settings.HalfWidth),
			y: Math.min(Math.max(Origin.y, Building.Position.y - Settings.HalfWidth), Building.Position.y + Settings.HalfWidth),
			z: Math.min(Math.max(Origin.z, Building.Position.z), Building.Position.z + Settings.Height),
		};
		const Distance: number = VectorMath.Size(VectorMath.Subtract(Nearest, Origin));
		if (Distance > Radius)
		{
			continue;
		}
		const Sight: TraceResult = Instance.TraceLine({ start: Origin, end: GetBuildingCenter(Building), ignorePlayers: true, ignoreEntity: GetBuildingEntities(Building) });
		if (Sight.didHit && !Sight.startedInSolid)
		{
			continue;
		}
		DamageBuilding(Building, Damage * (1 - 0.5 * (Distance / Radius)), Attacker);
	}
}

function GetBuildingByEntity(Ent: Entity | undefined): FBuilding | undefined
{
	if (!Ent)
	{
		return undefined;
	}
	return GBuildings.find((Building: FBuilding): boolean =>
	{
		return Building.Models.some((Model: FBuildingModel): boolean =>
		{
			return Model.Ent === Ent;
		});
	});
}

// Slab test. A start inside the box counts as hitting it straight away.
function IntersectSegmentBox(Start: FVector, End: FVector, Mins: FVector, Maxs: FVector): FBoxHit | undefined
{
	const Delta: FVector = VectorMath.Subtract(End, Start);
	let Enter: number = 0;
	let Exit: number = 1;
	let Normal: FVector = VectorMath.Scale(VectorMath.GetSafeNormal(Delta), -1);
	for (const Axis of Axes)
	{
		if (Math.abs(Delta[Axis]) < 1e-6)
		{
			if (Start[Axis] < Mins[Axis] || Start[Axis] > Maxs[Axis])
			{
				return undefined;
			}
			continue;
		}
		let Near: number = (Mins[Axis] - Start[Axis]) / Delta[Axis];
		let Far: number = (Maxs[Axis] - Start[Axis]) / Delta[Axis];
		let Facing: number = -1;
		if (Near > Far)
		{
			[Near, Far] = [Far, Near];
			Facing = 1;
		}
		if (Near > Enter)
		{
			Enter = Near;
			Normal = { x: Axis === "x" ? Facing : 0, y: Axis === "y" ? Facing : 0, z: Axis === "z" ? Facing : 0 };
		}
		Exit = Math.min(Exit, Far);
		if (Enter > Exit)
		{
			return undefined;
		}
	}
	return { Fraction: Enter, Normal: Normal };
}

// Models //////////////////////////////////////////////////////////////////////////////////////////

function SpawnModels(TemplateName: string, Position: FVector): FBuildingModel[]
{
	if (TemplateName === "")
	{
		return [];
	}
	return SpawnTemplateEntities(TemplateName, Position, undefined).map((Ent: Entity): FBuildingModel =>
	{
		return { Ent: Ent, LocalRotation: RotationMath.FromRotator(Ent.GetAbsAngles()) };
	});
}

function PlaceModels(Models: readonly FBuildingModel[], Position: FVector, Yaw: number, bTeleport: boolean): void
{
	const Facing: FRotationMatrix = RotationMath.FromRotator({ pitch: 0, yaw: Yaw, roll: 0 });
	for (const Model of Models)
	{
		if (!Model.Ent.IsValid() || Model.Ent.GetParent() !== undefined)
		{
			continue;
		}
		const Placement: { position: FVector, angles: FRotator } = { position: Position, angles: RotationMath.ToRotator(RotationMath.Multiply(Facing, Model.LocalRotation)) };
		if (bTeleport)
		{
			Model.Ent.Teleport(Placement);
		}
		else
		{
			Model.Ent.Move(Placement);
		}
	}
}

function GetBuildingColor(Building: FBuilding, Now: number): FColor
{
	return Building.Kind.GetColor(Building, Now) ?? GetColorForTeam(Building.Team);
}

function TintBuilding(Building: FBuilding, Color: FColor): void
{
	const Key: string = `${Color.r},${Color.g},${Color.b}`;
	if (Key === Building.ColorKey)
	{
		return;
	}
	Building.ColorKey = Key;
	for (const Model of Building.Models)
	{
		if (Model.Ent.IsValid() && IsModelEntity(Model.Ent))
		{
			Model.Ent.SetColor(Color);
		}
	}
}

function RemoveModels(Models: readonly FBuildingModel[]): void
{
	for (const Model of Models)
	{
		if (Model.Ent.IsValid())
		{
			Model.Ent.Remove();
		}
	}
}

function GetModelEntities(Models: readonly FBuildingModel[]): Entity[]
{
	return Models.filter((Model: FBuildingModel): boolean =>
	{
		return Model.Ent.IsValid();
	}).map((Model: FBuildingModel): Entity =>
	{
		return Model.Ent;
	});
}

function DrawBuildingBox(Position: FVector, Settings: FBuildingSettings, Color: FColor): void
{
	Instance.DebugBox(
	{
		mins: VectorMath.Add(Position, { x: -Settings.HalfWidth, y: -Settings.HalfWidth, z: 0 }),
		maxs: VectorMath.Add(Position, { x: Settings.HalfWidth, y: Settings.HalfWidth, z: Settings.Height }),
		duration: TickInterval * 2,
		color: Color,
	});
}