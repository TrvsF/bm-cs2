import { Instance, CSInputs } from "cs_script/point_script";
import type { CSPlayerPawn, CSWeaponBase } from "cs_script/point_script";
import { bDebug, SpawnFromTemplate } from "./bm_core";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

// A gun the script fires itself. The real gun is kept empty so it never shoots:
// no muzzle flash, tracers, bullet holes, recoil or gunshot sound. You will still hear CS's empty-gun click.
export interface FLauncherSettings
{
	readonly FireInterval: number;      // seconds between shots, holding fire repeats at this rate
	readonly ClipSize: number;
	readonly SpareAmmo: number;         // carried on top of the clip
	readonly ReloadFirstTime: number;   // reloads one at a time like TF2, and the first one takes a bit longer
	readonly ReloadEachTime: number;
	readonly FireFxTemplate: string;    // point_template spawned at the shooter's eyes on each shot, for your own sound/particle. "" for none.
}

// What the ammo HUD shows
export interface FLauncherAmmo
{
	readonly Clip: number;
	readonly Spare: number;
	readonly bReloading: boolean;
}

interface FLauncherState
{
	readonly Settings: FLauncherSettings;
	readonly WeaponName: string;
	Clip: number;
	Spare: number;
	NextFireTime: number;
	NextReloadTime: number | undefined;   // undefined when not reloading
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const GLaunchers: Map<number, FLauncherState[]> = new Map<number, FLauncherState[]>();   // a player can have one per gun

// Launcher ////////////////////////////////////////////////////////////////////////////////////////

// Call after giving the player their gun. Fills the script's clip and empties the real one.
export function EquipLauncher(Pawn: CSPlayerPawn, Slot: number, WeaponName: string, Settings: FLauncherSettings): void
{
	const Launchers: FLauncherState[] = (GLaunchers.get(Slot) ?? []).filter((Other: FLauncherState): boolean =>
	{
		return Other.WeaponName !== WeaponName;
	});
	Launchers.push(
	{
		Settings: Settings,
		WeaponName: WeaponName,
		Clip: Settings.ClipSize,
		Spare: Settings.SpareAmmo,
		NextFireTime: 0,
		NextReloadTime: undefined,
	});
	GLaunchers.set(Slot, Launchers);
	EmptyRealGun(Pawn, WeaponName);
}

export function ClearLauncher(Slot: number): void
{
	GLaunchers.delete(Slot);
}

// Runs one player's launchers for this tick. Returns the name of the gun that fired, if one did.
export function TickLauncher(Pawn: CSPlayerPawn, Slot: number, Now: number): string | undefined
{
	const Launchers: FLauncherState[] | undefined = GLaunchers.get(Slot);
	if (!Launchers)
	{
		return undefined;
	}

	const Active: CSWeaponBase | undefined = Pawn.GetActiveWeapon();
	let FiredWeapon: string | undefined = undefined;
	for (const State of Launchers)
	{
		// Every tick, in case anything refills it (sv_infinite_ammo, round restarts)
		const Weapon: CSWeaponBase | undefined = EmptyRealGun(Pawn, State.WeaponName);
		if (!Weapon || Active !== Weapon)
		{
			State.NextReloadTime = undefined;   // switching away cancels a reload
			continue;
		}
		if (TickHeldLauncher(Pawn, State, Now))
		{
			FiredWeapon = State.WeaponName;
		}
	}
	return FiredWeapon;
}

// The ammo to show, or undefined if they're not holding a launcher
export function GetLauncherAmmo(Pawn: CSPlayerPawn, Slot: number): FLauncherAmmo | undefined
{
	const Launchers: FLauncherState[] | undefined = GLaunchers.get(Slot);
	const Active: CSWeaponBase | undefined = Pawn.GetActiveWeapon();
	if (!Launchers || !Active)
	{
		return undefined;
	}
	for (const State of Launchers)
	{
		if (Pawn.FindWeapon(State.WeaponName) === Active)
		{
			return { Clip: State.Clip, Spare: State.Spare, bReloading: State.NextReloadTime !== undefined };
		}
	}
	return undefined;
}

// The launcher in their hands: fire if they're holding the trigger, otherwise reload
function TickHeldLauncher(Pawn: CSPlayerPawn, State: FLauncherState, Now: number): boolean
{
	const bFireHeld: boolean = Pawn.IsInputPressed(CSInputs.ATTACK) && !Pawn.IsBuyMenuOpen() && !Instance.IsFreezePeriod();
	if (bFireHeld && State.Clip > 0)
	{
		State.NextReloadTime = undefined;   // firing interrupts a reload, like TF2
		if (Now < State.NextFireTime)
		{
			return false;
		}
		State.Clip--;
		State.NextFireTime = Now + State.Settings.FireInterval;
		SpawnFireFx(Pawn, State.Settings);
		return true;
	}

	TickReload(Pawn, State, Now);
	return false;
}

// Reload starts on R or when the clip runs dry, then loads one at a time until full or out of spare ammo.
// With bDebug on, spare ammo never runs out.
function TickReload(Pawn: CSPlayerPawn, State: FLauncherState, Now: number): void
{
	if (!CanReload(State))
	{
		State.NextReloadTime = undefined;
		return;
	}

	if (State.NextReloadTime === undefined)
	{
		const bWantsReload: boolean = State.Clip === 0 || Pawn.WasInputJustPressed(CSInputs.RELOAD);
		if (bWantsReload)
		{
			State.NextReloadTime = Math.max(Now, State.NextFireTime) + State.Settings.ReloadFirstTime;
		}
		return;
	}

	if (Now < State.NextReloadTime)
	{
		return;
	}
	State.Clip++;
	if (!bDebug)
	{
		State.Spare--;
	}
	State.NextReloadTime = CanReload(State) ? Now + State.Settings.ReloadEachTime : undefined;
}

function CanReload(State: FLauncherState): boolean
{
	return State.Clip < State.Settings.ClipSize && (State.Spare > 0 || bDebug);
}

// Keeps the real gun at 0 / 0 so pulling the trigger only ever dry-fires
function EmptyRealGun(Pawn: CSPlayerPawn, WeaponName: string): CSWeaponBase | undefined
{
	const Weapon: CSWeaponBase | undefined = Pawn.FindWeapon(WeaponName);
	if (!Weapon)
	{
		return undefined;
	}
	if (Weapon.GetClipAmmo() !== 0)
	{
		Weapon.SetClipAmmo(0);
	}
	if (Weapon.GetReserveAmmo() !== 0)
	{
		Weapon.SetReserveAmmo(0);
	}
	return Weapon;
}

function SpawnFireFx(Pawn: CSPlayerPawn, Settings: FLauncherSettings): void
{
	if (Settings.FireFxTemplate !== "")
	{
		SpawnFromTemplate(Settings.FireFxTemplate, Pawn.GetEyePosition());
	}
}
