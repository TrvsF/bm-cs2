import { Instance, Console, CSGearSlot, CSDamageTypes, CSDamageFlags, CSHitGroup } from "cs_script/point_script";
import type { CSPlayerPawn, CSWeaponBase } from "cs_script/point_script";
import { LogPrefix, VectorMath, GetTeamColor, GetPlayerSlot, GetOrCreate, GetAimAngles, GetChestPosition, IsWeapon, IsKnife } from "./bm_core";
import type { FVector, FRotator, FColor, FModifyDamageEvent, FModifyDamageResult } from "./bm_core";
import { EvaluateDamageCurve, TraceHitscan, GetSpreadDirection, GetRingDirection, ApplyKnockback } from "./bm_combat";
import type { FDamageFalloff, FDamageCurve, FHitscanHit, FHitscanResult, FBallistics } from "./bm_combat";
import { SpawnBloodSplatter, SpawnBloodHit, SpawnBulletHole, SpawnBeam, SpawnTemporaryTemplate } from "./bm_effects";
import { EquipLauncher } from "./bm_launcher";
import { DamageBuilding } from "./bm_buildings";
import type { FBuildKeys } from "./bm_buildings";
import type { FLauncherSettings, FLauncherShot } from "./bm_launcher";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export enum EPlayerClass
{
	None = "none",
	Demoman = "demo",
	Solider = "soldier",
	Medic = "medic",
	Railer = "railer",
	Beamer = "beamer",
	Boxer = "boxer",
	Shocker = "shocker",
	Shrinker = "shrinker",
	Gunner = "builder",
}

export type EPlayableClass = Exclude<EPlayerClass, EPlayerClass.None>;

export interface FClassSettings
{
	readonly DisplayName: string;
	readonly PickFxTemplate: string;
	readonly Primary: string;
	readonly Secondary: string;
	readonly Melee: string;
	readonly Health: number;
	readonly SizeScale: number;
	readonly Model: string;
	readonly PrimaryLauncher: FLauncherSettings | undefined;
	readonly SecondaryLauncher: FLauncherSettings | undefined;
	readonly bStartWithMelee?: boolean;
	readonly bStartWithSecondary?: boolean;
	readonly MeleeDamage?: number;
	readonly RepairPerHit?: number;
}

export interface FHudCounter
{
	readonly Label: string;
	readonly Count: number;
	readonly Max: number;
}

export interface FRecoilSettings
{
	readonly Up: number;
	readonly Side: number;
	readonly MaxUp: number;
	readonly Recovery: number;
}

export interface FHitscanWeaponSettings
{
	readonly Damage: number;
	readonly HeadshotMultiplier: number;
	readonly Range: number;
	readonly Spread: number;
	readonly Pellets: number;
	readonly Recoil?: FRecoilSettings;
	readonly bPierces: boolean;
	readonly Falloff: FDamageCurve;
	readonly Knockback: number;
	readonly SelfKnockback: number;
	readonly bBloodSplatter: boolean;
	readonly bHeldBeam: boolean;
	readonly BeamTemplate: string;
	readonly BeamEndName: string;
	readonly BeamLifetime: number;
	readonly ImpactTemplate: string;
	readonly ImpactLifetime: number;
	readonly bBulletHoles?: boolean;
}

export interface FBotTrickShot
{
	readonly WeaponName: string;
	readonly Spot: FVector;
}

export interface FBotShot
{
	readonly Damage: number;
	readonly Spread: number;
	readonly Range: number;
	readonly Falloff: FDamageCurve;
	readonly BlastRadius: number;
	readonly SelfPush: number;
	readonly Ballistics: FBallistics | undefined;
}

interface FRecoilState
{
	Settings: FHitscanWeaponSettings;
	Up: number;
	Side: number;
	Time: number;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

export const TF2RocketFalloff: FDamageFalloff = { RampUp: 1.25, FallOff: 0.5, OptimalDistance: 512 };
export const TF2PipeFalloff: FDamageFalloff = { RampUp: 1, FallOff: 0.9, OptimalDistance: 512 };

// TF2's scaling for bullets: a weapon's Damage is what it does at 512u, rising to half as much again point blank and falling to half from 1024u on
export const TF2HitscanFalloff: FDamageCurve =
[
	{ Distance: 0, Scale: 1.5 },
	{ Distance: 512, Scale: 1.0 },
	{ Distance: 1024, Scale: 0.5 },
];

const PlayableClasses: readonly EPlayableClass[] = Object.values(EPlayerClass).filter((PlayerClass: EPlayerClass): PlayerClass is EPlayableClass =>
{
	return PlayerClass !== EPlayerClass.None;
});

const MaxBeamHits: number = 8;
const ProjectileBotRange: number = 4096;
const DefaultHealth: number = 100;
const DefaultSizeScale: number = 1.0;
const StrippedGearSlots: readonly CSGearSlot[] = [CSGearSlot.RIFLE, CSGearSlot.PISTOL, CSGearSlot.KNIFE, CSGearSlot.GRENADES];
const NoClassStrippedGearSlots: readonly CSGearSlot[] = [CSGearSlot.RIFLE, CSGearSlot.PISTOL, CSGearSlot.GRENADES];
const NoClassMelee: string = "weapon_knife";
const FallbackMelee: string = "weapon_knife";
const PickFxLifetime: number = 3;

const GOwnModels: Map<number, Map<number, string>> = new Map<number, Map<number, string>>();
const GClassModels: Set<string> = new Set<string>();
const GWarnedModels: Set<string> = new Set<string>();
const UntintedColor: FColor = { r: 255, g: 255, b: 255 };
const GRecoilBySlot: Map<number, FRecoilState> = new Map<number, FRecoilState>();

export const BeamStartDrop: FVector = { x: 0, y: 0, z: 12 };

// Body ////////////////////////////////////////////////////////////////////////////////////////////

export function ApplyBody(Pawn: CSPlayerPawn, Health: number, SizeScale: number, Model: string): void
{
	Pawn.SetMaxHealth(Health);
	Pawn.SetHealth(Health);
	ApplyModel(Pawn, Model);
	Pawn.SetModelScale(SizeScale);
}

export function RestoreDefaultBody(Pawn: CSPlayerPawn): void
{
	ApplyBody(Pawn, DefaultHealth, DefaultSizeScale, "");
}

export function HideBody(Pawn: CSPlayerPawn): void
{
	const OwnModels: Map<number, string> | undefined = GOwnModels.get(GetPlayerSlot(Pawn));
	const Own: string | undefined = OwnModels ? OwnModels.get(Pawn.GetTeamNumber()) : undefined;
	if (Own !== undefined)
	{
		Pawn.SetModel(Own);
	}
	Pawn.SetColor({ ...Pawn.GetColor(), a: 0 });
}

export function ShowBody(Pawn: CSPlayerPawn): void
{
	Pawn.SetColor({ ...Pawn.GetColor(), a: 255 });
}

export function ForgetPlayerModel(Slot: number): void
{
	GOwnModels.delete(Slot);
}

function ApplyModel(Pawn: CSPlayerPawn, Model: string): void
{
	const OwnModels: Map<number, string> = GetOrCreate(GOwnModels, GetPlayerSlot(Pawn), (): Map<number, string> =>
	{
		return new Map<number, string>();
	});
	const Team: number = Pawn.GetTeamNumber();
	const Current: string = Pawn.GetModelName();
	if (Current !== "" && !GClassModels.has(NormalizeModelName(Current)))
	{
		OwnModels.set(Team, Current);
	}

	const Wanted: string | undefined = Model !== "" ? Model : OwnModels.get(Team);
	if (Wanted !== undefined && NormalizeModelName(Wanted) !== NormalizeModelName(Current))
	{
		if (Model !== "")
		{
			GClassModels.add(NormalizeModelName(Model));
		}
		Pawn.SetModel(Wanted);
		if (NormalizeModelName(Pawn.GetModelName()) !== NormalizeModelName(Wanted) && !GWarnedModels.has(Wanted))
		{
			GWarnedModels.add(Wanted);
			Console.Log(`${LogPrefix} couldn't put on model "${Wanted}": is it in the map? Add a prop_dynamic using it somewhere out of sight so it's loaded.`);
		}
	}
	// Class models are tinted their team's colour so which side they're on is obvious; the player's own model is left as is
	Pawn.SetColor(Model !== "" ? GetTeamColor(Pawn) : UntintedColor);
}

function NormalizeModelName(Name: string): string
{
	return Name.toLowerCase().replace(/\\/g, "/").replace(/_c$/, "");
}

function IsBulletDamage(Event: FModifyDamageEvent): boolean
{
	return (Event.damageTypes & (CSDamageTypes.BULLET | CSDamageTypes.BUCKSHOT)) !== 0;
}

function StripGearSlots(Pawn: CSPlayerPawn, GearSlots: readonly CSGearSlot[]): void
{
	for (const GearSlot of GearSlots)
	{
		for (let Attempt: number = 0; Attempt < 6; Attempt++)
		{
			const Weapon: CSWeaponBase | undefined = Pawn.FindWeaponBySlot(GearSlot);
			if (!Weapon)
			{
				break;
			}
			Pawn.DestroyWeapon(Weapon);
		}
	}
}

// Classes /////////////////////////////////////////////////////////////////////////////////////////

export abstract class PlayerClass<TSettings extends FClassSettings>
{
	public readonly Settings: TSettings;

	constructor(Settings: TSettings)
	{
		this.Settings = Settings;
	}

	public ApplyLoadout(Pawn: CSPlayerPawn): void
	{
		StripGearSlots(Pawn, StrippedGearSlots);
		ApplyBody(Pawn, this.Settings.Health, this.Settings.SizeScale, this.Settings.Model);

		if (this.Settings.Melee !== "")
		{
			Pawn.GiveNamedItem(this.Settings.Melee);
			if (!Pawn.FindWeaponBySlot(CSGearSlot.KNIFE))
			{
				Pawn.GiveNamedItem(FallbackMelee);
			}
		}

		const bHasSecondary: boolean = this.Settings.Secondary !== "" && this.Settings.Secondary !== this.Settings.Primary;
		if (bHasSecondary)
		{
			Pawn.GiveNamedItem(this.Settings.Secondary);
		}
		Pawn.GiveNamedItem(this.Settings.Primary, true);

		const Slot: number = GetPlayerSlot(Pawn);
		if (this.Settings.PrimaryLauncher)
		{
			EquipLauncher(Pawn, Slot, this.Settings.Primary, this.Settings.PrimaryLauncher);
		}
		if (bHasSecondary && this.Settings.SecondaryLauncher)
		{
			EquipLauncher(Pawn, Slot, this.Settings.Secondary, this.Settings.SecondaryLauncher);
		}

		const StartWeapon: CSWeaponBase | undefined = this.Settings.bStartWithMelee
			? Pawn.FindWeaponBySlot(CSGearSlot.KNIFE)
			: this.Settings.bStartWithSecondary && bHasSecondary ? Pawn.FindWeapon(this.Settings.Secondary) : undefined;
		if (StartWeapon)
		{
			Pawn.SwitchToWeapon(StartWeapon);
		}

		this.OnLoadoutApplied(Pawn);
	}

	// Override for class-specific setup. Runs after the shared loadout.
	protected OnLoadoutApplied(Pawn: CSPlayerPawn): void
	{
	}

	public PlayPickFx(Pawn: CSPlayerPawn): void
	{
		if (this.Settings.PickFxTemplate !== "")
		{
			SpawnTemporaryTemplate(this.Settings.PickFxTemplate, Pawn.GetEyePosition(), PickFxLifetime);
		}
	}

	// Called when someone playing this class fires their primary
	// ChargeFraction is 0 to 1 for launchers that charge, else 0
	public OnPrimaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number, ChargeFraction: number): void
	{
	}

	// Called when someone playing this class fires their secondary
	public OnSecondaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number, ChargeFraction: number): void
	{
	}

	// Called for a launcher's second fire mode (ATTACK2), when its settings give it one
	public OnPrimaryAltFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
	}

	public OnSecondaryAltFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
	}

	// Passes a launcher shot on to the matching On...Fire
	public OnLauncherFired(Pawn: CSPlayerPawn, Slot: number, Now: number, Shot: FLauncherShot): void
	{
		if (Shot.WeaponName === this.Settings.Primary)
		{
			if (Shot.bAltFire)
			{
				this.OnPrimaryAltFire(Pawn, Slot, Now);
			}
			else
			{
				this.OnPrimaryFire(Pawn, Slot, Now, Shot.ChargeFraction);
			}
		}
		else if (Shot.WeaponName === this.Settings.Secondary)
		{
			if (Shot.bAltFire)
			{
				this.OnSecondaryAltFire(Pawn, Slot, Now);
			}
			else
			{
				this.OnSecondaryFire(Pawn, Slot, Now, Shot.ChargeFraction);
			}
		}
	}

	// The weapons a bot of this class shoots with: by default every one the script fires
	// WHAT ^
	public GetBotWeapons(): string[]
	{
		const Weapons: string[] = this.Settings.PrimaryLauncher ? [this.Settings.Primary] : [];
		if (this.Settings.SecondaryLauncher && this.Settings.Secondary !== "" && this.Settings.Secondary !== this.Settings.Primary)
		{
			Weapons.push(this.Settings.Secondary);
		}
		return Weapons;
	}

	// Override so bots know what a weapon does. undefined = they fire it at anything they see.
	public GetBotShot(WeaponName: string): FBotShot | undefined
	{
		return undefined;
	}

	// Runs every tick for a bot of this class, for whatever the class wants its bots to do on their own (use an ability, set off their bombs).
	// Enemy = who the bot is after, if anyone. Returns any keys to hold down for it this tick, on top of what it presses itself.
	public TickBot(Pawn: CSPlayerPawn, Slot: number, Now: number, Enemy: CSPlayerPawn | undefined): number
	{
		return 0;
	}

	// Something a bot of this class should shoot right now instead of its target (its own projectile, say, to set it off)
	public GetBotTrickShot(Pawn: CSPlayerPawn, Now: number): FBotTrickShot | undefined
	{
		return undefined;
	}

	// Override for a class whose bots should get behind enemies and knife them instead of shooting
	public IsBotStabber(): boolean
	{
		return false;
	}

	// Override for a class whose bots should follow and heal teammates (melee out, attack held) instead of fighting
	public IsBotHealer(): boolean
	{
		return false;
	}

	// Override for a class that builds: the weapon its bots hold to build with
	public GetBotBuildTool(Pawn: CSPlayerPawn): CSWeaponBase | undefined
	{
		return undefined;
	}

	// Called every tick, whether or not anyone is playing this class
	public TickWorld(Now: number, DeltaTime: number): void
	{
	}

	// Called every tick for each living player of this class, after every class's TickWorld
	public TickPlayer(Pawn: CSPlayerPawn, Slot: number, Now: number, DeltaTime: number): void
	{
	}

	// Called every tick after every player has been ticked
	public TickWorldLate(Now: number, DeltaTime: number): void
	{
	}

	public OnRoundStart(): void
	{
	}

	// Called on every class when a player dies, respawns, switches class or leaves, so their leftovers get cleaned up
	public ClearPlayer(Slot: number): void
	{
	}

	// Override to change or block damage dealt by this class
	public ModifyOutgoingDamage(Event: FModifyDamageEvent): FModifyDamageResult
	{
		if (this.Settings.MeleeDamage !== undefined && IsKnife(Event.weapon))
		{
			return this.Settings.MeleeDamage > 0 ? { damage: this.Settings.MeleeDamage } : { abort: true };
		}
		if (this.IsPrimaryBulletDamage(Event) || this.IsSecondaryBulletDamage(Event))
		{
			return { abort: true };
		}
	}

	// Called for every damage event, whoever deals it (e.g. über protecting a patient)
	public ModifyAnyDamage(Event: FModifyDamageEvent): FModifyDamageResult
	{
		return;
	}

	// Override for a class that heals: who it's healing right now, so their health stays on its HUD
	public GetHealTarget(Slot: number): CSPlayerPawn | undefined
	{
		return undefined;
	}

	// Override for a class that builds: what each mouse button builds right now, or undefined while its build tool isn't out
	public GetBuildKeys(Pawn: CSPlayerPawn): FBuildKeys | undefined
	{
		return undefined;
	}

	// Override to put a counter on this class's HUD. undefined = none.
	public GetHudCounter(Slot: number): FHudCounter | undefined
	{
		return undefined;
	}

	// True for the primary's own bullets, as opposed to explosions or beams the script deals in its name
	protected IsPrimaryBulletDamage(Event: FModifyDamageEvent): boolean
	{
		return IsBulletDamage(Event) && IsWeapon(Event.weapon, this.Settings.Primary);
	}

	// True for the secondary's own bullets
	protected IsSecondaryBulletDamage(Event: FModifyDamageEvent): boolean
	{
		return IsBulletDamage(Event) && this.Settings.Secondary !== "" && IsWeapon(Event.weapon, this.Settings.Secondary);
	}
}

// Hitscan weapons ////////////////////////////////////////////////////////////////////////////////////

export function FireHitscanWeapon(Shooter: CSPlayerPawn, Settings: FHitscanWeaponSettings, Weapon: CSWeaponBase | undefined, Intercept?: (Start: FVector, End: FVector) => FVector | undefined): void
{
	const Start: FVector = Shooter.GetEyePosition();
	const Aim: FRotator = GetAimAngles(Shooter);
	const Recoil: FRecoilState = GetRecoil(Shooter, Settings);
	const bPellets: boolean = Settings.Pellets > 1;
	const Kicked: FRotator = bPellets ? Aim : { pitch: Aim.pitch - Recoil.Up, yaw: Aim.yaw + Recoil.Side, roll: 0 };
	const Fired: FHitscanWeaponSettings = bPellets ? { ...Settings, Spread: Settings.Spread + Recoil.Up } : Settings;
	FireHitscan(Shooter, Fired, Weapon, Start, Kicked, VectorMath.Subtract(Start, BeamStartDrop), Intercept);
	KickRecoil(Recoil);

	const Backwards: FVector = VectorMath.Scale(VectorMath.GetForwardVector(Aim), -1);
	ApplyKnockback(Shooter, Backwards, Settings.Damage * Settings.Pellets, Settings.SelfKnockback, true);
}

export function FireHitscan(Attacker: CSPlayerPawn, Settings: FHitscanWeaponSettings, Weapon: CSWeaponBase | undefined, Start: FVector, Aim: FRotator, BeamStart: FVector, Intercept?: (Start: FVector, End: FVector) => FVector | undefined): number
{
	let DamageTotal: number = 0;
	for (let Pellet: number = 0; Pellet < Settings.Pellets; Pellet++)
	{
		const Direction: FVector = Settings.Pellets > 1 ? GetRingDirection(Aim, Settings.Spread, Pellet, Settings.Pellets) : GetSpreadDirection(Aim, Settings.Spread);
		const Result: FHitscanResult = TraceHitscanWeapon(Attacker, Settings, Start, Direction);
		const End: FVector = (Intercept ? Intercept(Start, Result.End) : undefined) ?? Result.End;
		const MaxDistance: number = VectorMath.Size(VectorMath.Subtract(End, Start));
		for (const Hit of Result.Hits)
		{
			const Distance: number = GetHitDistance(Hit, Start);
			if (Distance > MaxDistance)
			{
				continue;
			}
			const RangeScale: number = EvaluateDamageCurve(Settings.Falloff, Distance);
			const bHeadshot: boolean = Hit.Trace.hitGroup === CSHitGroup.HEAD;
			const Damage: number = Settings.Damage * RangeScale * (bHeadshot ? Settings.HeadshotMultiplier : 1);

			ApplyKnockback(Hit.Victim, Direction, Damage, Settings.Knockback, false);
			const DamageDealt: number = DealShockDamage(Attacker, Hit.Victim, Damage, Weapon, Hit.Trace.end, Start);
			DamageTotal += DamageDealt;
			if (DamageDealt > 0 && Settings.bBloodSplatter)
			{
				SpawnBloodSplatter(Start, Hit.Victim);
			}
		}
		const BuildingDistance: number = VectorMath.Size(VectorMath.Subtract(Result.End, Start));
		if (Result.HitBuilding && BuildingDistance <= MaxDistance)
		{
			DamageBuilding(Result.HitBuilding, Settings.Damage * EvaluateDamageCurve(Settings.Falloff, BuildingDistance), Attacker);
		}

		if (!Settings.bHeldBeam)
		{
			SpawnBeam(Settings.BeamTemplate, Settings.BeamEndName, BeamStart, End, Settings.BeamLifetime, GetTeamColor(Attacker));
		}
		if (Settings.ImpactTemplate !== "")
		{
			SpawnTemporaryTemplate(Settings.ImpactTemplate, End, Settings.ImpactLifetime);
		}
		if (Settings.bBulletHoles && Result.Wall)
		{
			SpawnBulletHole(Result.Wall.end, Result.Wall.normal);
		}
	}
	return DamageTotal;
}

function GetRecoil(Shooter: CSPlayerPawn, Settings: FHitscanWeaponSettings): FRecoilState
{
	const Now: number = Instance.GetGameTime();
	const Slot: number = GetPlayerSlot(Shooter);
	let Recoil: FRecoilState | undefined = GRecoilBySlot.get(Slot);
	if (!Recoil || Recoil.Settings !== Settings)
	{
		Recoil = { Settings: Settings, Up: 0, Side: 0, Time: Now };
		GRecoilBySlot.set(Slot, Recoil);
	}
	const Settle: number = (Settings.Recoil ? Settings.Recoil.Recovery : 0) * (Now - Recoil.Time);
	Recoil.Up = Math.max(0, Recoil.Up - Settle);
	Recoil.Side = Math.sign(Recoil.Side) * Math.max(0, Math.abs(Recoil.Side) - Settle);
	Recoil.Time = Now;
	return Recoil;
}

function KickRecoil(Recoil: FRecoilState): void
{
	const Settings: FRecoilSettings | undefined = Recoil.Settings.Recoil;
	if (!Settings || Settings.MaxUp <= 0)
	{
		return;
	}
	const Climb: number = Math.max(0, 1 - Recoil.Up / Settings.MaxUp);
	const Jitter: number = Recoil.Settings.Pellets > 1 ? 1 : 0.5 + Math.random();
	Recoil.Up += Settings.Up * Climb * Jitter;
	Recoil.Side += Settings.Side * (Math.random() * 2 - 1);
}

export function GetHitscanBotShot(Settings: FHitscanWeaponSettings): FBotShot
{
	return { Damage: Settings.Damage * Settings.Pellets, Spread: Settings.Spread, Range: Settings.Range, Falloff: Settings.Falloff, BlastRadius: 0, SelfPush: Settings.SelfKnockback, Ballistics: undefined };
}

export function GetProjectileBotShot(Damage: number, BlastRadius: number, Ballistics: FBallistics, Falloff: FDamageCurve = [], SelfPush: number = 0): FBotShot
{
	return { Damage: Damage, Spread: 0, Range: ProjectileBotRange, Falloff: Falloff, BlastRadius: BlastRadius, SelfPush: SelfPush, Ballistics: Ballistics };
}

export function TraceHitscanWeapon(Shooter: CSPlayerPawn, Settings: FHitscanWeaponSettings, Start: FVector, Direction: FVector): FHitscanResult
{
	const MaxHits: number = Settings.bPierces ? MaxBeamHits : 1;
	return TraceHitscan(Shooter, Start, VectorMath.Add(Start, VectorMath.Scale(Direction, Settings.Range)), MaxHits);
}

function GetHitDistance(Hit: FHitscanHit, Start: FVector): number
{
	return VectorMath.Size(VectorMath.Subtract(Hit.Trace.end, Start));
}

export function DealShockDamage(Shooter: CSPlayerPawn, Victim: CSPlayerPawn, Damage: number, Weapon: CSWeaponBase | undefined, HitPosition: FVector = GetChestPosition(Victim), From: FVector = Shooter.GetEyePosition()): number
{
	const DamageDealt: number = Victim.TakeDamage(
	{
		damage: Damage,
		damageTypes: CSDamageTypes.SHOCK,
		damageFlags: CSDamageFlags.IGNORE_ARMOR,
		attacker: Shooter,
		inflictor: Shooter,
		weapon: Weapon,
	});
	if (DamageDealt > 0)
	{
		SpawnBloodHit(HitPosition, From);
	}
	return DamageDealt;
}

// Common //////////////////////////////////////////////////////////////////////////////////////////

export function PickRandomClass(): EPlayableClass
{
	const Index: number = Math.floor(Math.random() * PlayableClasses.length);
	return PlayableClasses[Index] ?? EPlayerClass.Solider;
}

export function GiveNoClassLoadout(Pawn: CSPlayerPawn): void
{
	StripGearSlots(Pawn, NoClassStrippedGearSlots);

	const Knife: CSWeaponBase | undefined = Pawn.FindWeaponBySlot(CSGearSlot.KNIFE);
	if (Knife)
	{
		Pawn.SwitchToWeapon(Knife);
	}
	else
	{
		Pawn.GiveNamedItem(NoClassMelee, true);
	}
}