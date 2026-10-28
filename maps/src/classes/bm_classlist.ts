import { CSGearSlot, CSWeaponType } from "cs_script/point_script";
import type { CSPlayerPawn, CSWeaponBase, CSWeaponData } from "cs_script/point_script";
import { IsWeapon } from "../bm_core";
import { EPlayerClass, PlayerClass } from "../bm_classes";
import type { EPlayableClass, FClassSettings } from "../bm_classes";
import { SoldierClass } from "./bm_soldier";
import { DemomanClass } from "./bm_demoman";
import { MedicClass } from "./bm_medic";
import { RailerClass } from "./bm_railer";
import { BeamerClass } from "./bm_beamer";
import { BoxerClass } from "./bm_boxer";
import { ShockerClass } from "./bm_shocker";
import { ShrinkerClass } from "./bm_shrinker";
import { GunnerClass } from "./bm_gunner";

// Class list //////////////////////////////////////////////////////////////////////////////////////

export const ClassDefinitions: Readonly<Record<EPlayableClass, PlayerClass<FClassSettings>>> =
{
	[EPlayerClass.Demoman]: new DemomanClass(),
	[EPlayerClass.Solider]: new SoldierClass(),
	[EPlayerClass.Medic]: new MedicClass(),
	[EPlayerClass.Railer]: new RailerClass(),
	[EPlayerClass.Beamer]: new BeamerClass(),
	[EPlayerClass.Boxer]: new BoxerClass(),
	[EPlayerClass.Shocker]: new ShockerClass(),
	[EPlayerClass.Shrinker]: new ShrinkerClass(),
	[EPlayerClass.Gunner]: new GunnerClass(),
};

export function GiveLoadout(Pawn: CSPlayerPawn, PlayerClass: EPlayableClass): void
{
	ClassDefinitions[PlayerClass].ApplyLoadout(Pawn);
}

export function IsWeaponAllowed(PlayerClass: EPlayerClass, Weapon: CSWeaponBase): boolean
{
	const Data: CSWeaponData | undefined = Weapon.GetData();
	if (!Data || Data.GetGearSlot() === CSGearSlot.C4)
	{
		return true;
	}

	const bIsKnife: boolean = Data.GetType() === CSWeaponType.KNIFE;
	if (PlayerClass === EPlayerClass.None)
	{
		return bIsKnife;
	}

	const Settings: FClassSettings = ClassDefinitions[PlayerClass].Settings;
	if (bIsKnife && Settings.Melee !== "")
	{
		return true;
	}
	for (const Allowed of [Settings.Primary, Settings.Secondary, Settings.Melee])
	{
		if (Allowed !== "" && IsWeapon(Weapon, Allowed))
		{
			return true;
		}
	}
	return false;
}