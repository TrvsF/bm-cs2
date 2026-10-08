import { Instance } from "cs_script/point_script";
import type { Entity, CSPlayerPawn, BaseModelEntity } from "cs_script/point_script";
import { bDebug, LogPrefix, TickInterval, ForEachLivePawn } from "./bm_core";
import type { FVector, FRotator, FColor } from "./bm_core";
import { SpawnTemporaryTemplate } from "./bm_effects";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FHealthKitSettings
{
	readonly Name: string;
	readonly HealFraction: number;
	readonly RespawnTime: number;
	readonly PickupRadius: number;
	readonly PickupHeight: number;
	readonly SpinDegreesPerSecond: number;
	readonly PickupFxTemplate: string;
	readonly RespawnFxTemplate: string;
}

interface FHealthKit
{
	readonly Entity: Entity;
	readonly VisibleScale: number;
	readonly BaseAngles: FRotator;
	RespawnTime: number | undefined;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

export const HealthKitSettings: FHealthKitSettings =
{
	Name: "healthkit",
	HealFraction: 0.5,
	RespawnTime: 10,
	PickupRadius: 52,
	PickupHeight: 64,
	SpinDegreesPerSecond: 90,
	PickupFxTemplate: "healthkit_pickup_template",
	RespawnFxTemplate: "healthkit_respawn_template",
};

const HiddenScale: number = 0.001;
const PickupBelowTolerance: number = 32
const FxLifetime: number = 3;
const RescanInterval: number = 1;
const KitClassNames: readonly string[] = ["prop_dynamic", "prop_dynamic_override"];
const DebugKitColor: FColor = { r: 80, g: 230, b: 120 };

let GHealthKits: FHealthKit[] = [];
let GNextRescanTime: number = 0;

// Health kits /////////////////////////////////////////////////////////////////////////////////////

export function TickHealthKits(Now: number): void
{
	if (Now >= GNextRescanTime)
	{
		RescanHealthKits();
		GNextRescanTime = Now + RescanInterval;
	}

	for (const Kit of GHealthKits)
	{
		if (!Kit.Entity.IsValid())
		{
			continue;
		}
		if (Kit.RespawnTime !== undefined)
		{
			if (Now < Kit.RespawnTime)
			{
				continue;
			}
			RespawnKit(Kit);
		}

		const Taker: CSPlayerPawn | undefined = FindKitTaker(Kit);
		if (Taker)
		{
			TakeKit(Kit, Taker, Now);
		}
		else if (IsModelEntity(Kit.Entity))
		{
			SpinKit(Kit, Kit.Entity, Now);
		}
		else if (bDebug)
		{
			Instance.DebugSphere({ center: Kit.Entity.GetAbsOrigin(), radius: 12, duration: TickInterval * 2, color: DebugKitColor });
		}
	}
}

export function ResetHealthKits(): void
{
	for (const Kit of GHealthKits)
	{
		if (Kit.Entity.IsValid() && Kit.RespawnTime !== undefined)
		{
			SetKitVisible(Kit, true);
		}
		Kit.RespawnTime = undefined;
	}
	GNextRescanTime = 0;
}

function RescanHealthKits(): void
{
	const Found: Set<Entity> = new Set<Entity>(Instance.FindEntitiesByName(HealthKitSettings.Name));
	for (const ClassName of KitClassNames)
	{
		for (const Ent of Instance.FindEntitiesByClass(ClassName))
		{
			if (Ent.GetEntityName().includes(HealthKitSettings.Name))
			{
				Found.add(Ent);
			}
		}
	}

	const Known: Map<Entity, FHealthKit> = new Map<Entity, FHealthKit>();
	for (const Kit of GHealthKits)
	{
		Known.set(Kit.Entity, Kit);
	}

	const Kits: FHealthKit[] = [];
	for (const Ent of Found)
	{
		if (!Ent.IsValid())
		{
			continue;
		}
		const Existing: FHealthKit | undefined = Known.get(Ent);
		if (Existing)
		{
			Kits.push(Existing);
		}
		else
		{
			Kits.push({ Entity: Ent, VisibleScale: IsModelEntity(Ent) ? Ent.GetModelScale() : 1, BaseAngles: Ent.GetAbsAngles(), RespawnTime: undefined });
		}
	}
	GHealthKits = Kits;
}

function FindKitTaker(Kit: FHealthKit): CSPlayerPawn | undefined
{
	const KitPosition: FVector = Kit.Entity.GetAbsOrigin();
	let Taker: CSPlayerPawn | undefined = undefined;
	ForEachLivePawn((Pawn: CSPlayerPawn): void =>
	{
		if (Taker || Pawn.GetHealth() >= Pawn.GetMaxHealth())
		{
			return;
		}
		const Feet: FVector = Pawn.GetAbsOrigin();
		const FlatDistance: number = Math.hypot(Feet.x - KitPosition.x, Feet.y - KitPosition.y);
		const Height: number = Feet.z - KitPosition.z;
		if (FlatDistance <= HealthKitSettings.PickupRadius && Height >= -PickupBelowTolerance && Height <= HealthKitSettings.PickupHeight)
		{
			Taker = Pawn;
		}
	});
	return Taker;
}

function TakeKit(Kit: FHealthKit, Taker: CSPlayerPawn, Now: number): void
{
	const MaxHealth: number = Taker.GetMaxHealth();
	const OldHealth: number = Taker.GetHealth();
	const NewHealth: number = Math.min(MaxHealth, OldHealth + Math.ceil(MaxHealth * HealthKitSettings.HealFraction));
	Taker.SetHealth(NewHealth);

	SetKitVisible(Kit, false);
	Kit.RespawnTime = Now + HealthKitSettings.RespawnTime;
	SpawnKitFx(HealthKitSettings.PickupFxTemplate, Kit);

	if (bDebug)
	{
		const Name: string = Taker.GetPlayerController()?.GetPlayerName() ?? "someone";
		Instance.Msg(`${LogPrefix} ${Name} took a health kit: ${OldHealth} -> ${NewHealth}`);
	}
}

function RespawnKit(Kit: FHealthKit): void
{
	Kit.RespawnTime = undefined;
	SetKitVisible(Kit, true);
	SpawnKitFx(HealthKitSettings.RespawnFxTemplate, Kit);
}

function SpinKit(Kit: FHealthKit, Model: BaseModelEntity, Now: number): void
{
	if (HealthKitSettings.SpinDegreesPerSecond === 0)
	{
		return;
	}
	const Yaw: number = (Kit.BaseAngles.yaw + Now * HealthKitSettings.SpinDegreesPerSecond) % 360;
	Model.Move({ angles: { pitch: Kit.BaseAngles.pitch, yaw: Yaw, roll: Kit.BaseAngles.roll } });
}

function SetKitVisible(Kit: FHealthKit, bVisible: boolean): void
{
	if (IsModelEntity(Kit.Entity))
	{
		Kit.Entity.SetModelScale(bVisible ? Kit.VisibleScale : HiddenScale);
	}
}

function SpawnKitFx(TemplateName: string, Kit: FHealthKit): void
{
	if (TemplateName !== "")
	{
		SpawnTemporaryTemplate(TemplateName, Kit.Entity.GetAbsOrigin(), FxLifetime);
	}
}

function IsModelEntity(Ent: Entity): Ent is BaseModelEntity
{
	return "SetModelScale" in Ent && typeof Ent.SetModelScale === "function";
}
