import { Instance, GameRules, CSInputs } from "cs_script/point_script";
import type { Entity, CSPlayerPawn, CSWeaponBase } from "cs_script/point_script";
import { TickInterval } from "./bm_core";
import { SpawnTemporaryTemplate } from "./bm_effects";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FLauncherSettings
{
	readonly FireInterval: number;
	readonly ClipSize: number;
	readonly ReloadFirstTime: number;
	readonly ReloadEachTime: number;
	readonly ChargeTime: number;
	// Seconds after the weapon is pulled out before it can fire or reload
	readonly DeployTime: number;
	readonly FireFxTemplate: string;
	readonly ReloadFxTemplate: string;
	// Set to give the weapon a second fire mode on ATTACK2, drawing from the same clip
	readonly AltFireInterval?: number;
	readonly AltFireFxTemplate?: string;
}

export interface FLauncherShot
{
	readonly WeaponName: string;
	readonly bAltFire: boolean;
}

export interface FLauncherAmmo
{
	readonly Clip: number;
	readonly MaxClip: number;
	readonly bReloading: boolean;
	readonly ChargeFraction: number;
	readonly ReloadFraction: number;
}

interface FLauncherState
{
	readonly Settings: FLauncherSettings;
	readonly WeaponName: string;
	Clip: number;
	MaxClip: number;
	NextFireTime: number;
	NextReloadTime: number | undefined;
	ReloadStartTime: number;
	ChargeStartTime: number | undefined;
	DrawnAt: number | undefined;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const FireFxLifetime: number = 3;
const ReloadFxLifetime: number = 3;

const GLaunchers: Map<number, FLauncherState[]> = new Map<number, FLauncherState[]>();

// Launcher ////////////////////////////////////////////////////////////////////////////////////////

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
		MaxClip: Settings.ClipSize,
		NextFireTime: 0,
		NextReloadTime: undefined,
		ReloadStartTime: 0,
		ChargeStartTime: undefined,
		DrawnAt: undefined,
	});
	GLaunchers.set(Slot, Launchers);
	EmptyRealGun(Pawn, WeaponName);
}

export function ClearLauncher(Slot: number): void
{
	GLaunchers.delete(Slot);
}

export function TickLauncher(Pawn: CSPlayerPawn, Slot: number, Now: number): FLauncherShot | undefined
{
	const Launchers: FLauncherState[] | undefined = GLaunchers.get(Slot);
	if (!Launchers)
	{
		return undefined;
	}

	const Active: CSWeaponBase | undefined = Pawn.GetActiveWeapon();
	let Shot: FLauncherShot | undefined = undefined;
	for (const State of Launchers)
	{
		const Weapon: CSWeaponBase | undefined = EmptyRealGun(Pawn, State.WeaponName);
		if (!Weapon || Active !== Weapon)
		{
			State.NextReloadTime = undefined;
			State.ChargeStartTime = undefined;
			State.DrawnAt = undefined;
			continue;
		}
		State.DrawnAt ??= Now;
		if (Now - State.DrawnAt < State.Settings.DeployTime)
		{
			continue;
		}
		Shot = TickHeldLauncher(Pawn, State, Now) ?? Shot;
	}
	return Shot;
}

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
			const Ammo: FLauncherAmmo =
			{
				Clip: State.Clip,
				MaxClip: State.MaxClip,
				bReloading: State.NextReloadTime !== undefined,
				ChargeFraction: GetChargeFraction(State),
				ReloadFraction: GetReloadFraction(State),
			};
			return Ammo;
		}
	}
	return undefined;
}

// ATTACK wins if both are held. The alt mode has no charge-up.
function TickHeldLauncher(Pawn: CSPlayerPawn, State: FLauncherState, Now: number): FLauncherShot | undefined
{
	const bCanFire: boolean = !Pawn.IsBuyMenuOpen() && !GameRules.IsFreezePeriod();
	const bMainHeld: boolean = bCanFire && Pawn.IsInputPressed(CSInputs.ATTACK);
	const bAltFire: boolean = bCanFire && !bMainHeld && State.Settings.AltFireInterval !== undefined && Pawn.IsInputPressed(CSInputs.ATTACK2);
	if ((bMainHeld || bAltFire) && State.Clip > 0)
	{
		State.NextReloadTime = undefined;
		if (Now < State.NextFireTime)
		{
			State.ChargeStartTime = undefined;
			return undefined;
		}
		if (bMainHeld && State.Settings.ChargeTime > 0)
		{
			if (State.ChargeStartTime === undefined)
			{
				State.ChargeStartTime = Now;
			}
			if (Now - State.ChargeStartTime < State.Settings.ChargeTime)
			{
				return undefined;
			}
		}
		State.ChargeStartTime = undefined;
		State.Clip--;

		const Interval: number = bAltFire ? State.Settings.AltFireInterval ?? State.Settings.FireInterval : State.Settings.FireInterval;
		const bHeldThrough: boolean = Now - State.NextFireTime < TickInterval * 1.5;
		State.NextFireTime = (bHeldThrough ? State.NextFireTime : Now) + Interval;
		SpawnFireFx(Pawn, bAltFire ? State.Settings.AltFireFxTemplate ?? State.Settings.FireFxTemplate : State.Settings.FireFxTemplate);
		return { WeaponName: State.WeaponName, bAltFire: bAltFire };
	}

	State.ChargeStartTime = undefined;
	TickReload(Pawn, State, Now);
	return undefined;
}

function GetChargeFraction(State: FLauncherState): number
{
	if (State.ChargeStartTime === undefined || State.Settings.ChargeTime <= 0)
	{
		return 0;
	}
	return Math.min(1, (Instance.GetGameTime() - State.ChargeStartTime) / State.Settings.ChargeTime);
}

// How far through loading the next round (or the whole clip) the reload is
function GetReloadFraction(State: FLauncherState): number
{
	if (State.NextReloadTime === undefined)
	{
		return 0;
	}
	return GetWaitFraction(State.ReloadStartTime, State.NextReloadTime, Instance.GetGameTime());
}

function GetWaitFraction(WaitStart: number, ReadyTime: number, Now: number): number
{
	if (Now >= ReadyTime || ReadyTime <= WaitStart)
	{
		return 1;
	}
	return Math.max(0, (Now - WaitStart) / (ReadyTime - WaitStart));
}

function TickReload(Pawn: CSPlayerPawn, State: FLauncherState, Now: number): void
{
	if (!CanReload(State))
	{
		State.NextReloadTime = undefined;
		return;
	}

	if (State.NextReloadTime === undefined)
	{
		// const bWantsReload: boolean = State.Clip === 0 || Pawn.WasInputJustPressed(CSInputs.RELOAD);
		// if (bWantsReload)
		// {
		State.ReloadStartTime = Math.max(Now, State.NextFireTime);
		State.NextReloadTime = State.ReloadStartTime + State.Settings.ReloadFirstTime;
		// }
		return;
	}

	if (Now < State.NextReloadTime)
	{
		return;
	}
	State.Clip = State.Settings.ReloadEachTime > 0 ? State.Clip + 1 : State.Settings.ClipSize;
	SpawnReloadFx(Pawn, State.Settings);
	State.ReloadStartTime = Now;
	State.NextReloadTime = CanReload(State) ? Now + State.Settings.ReloadEachTime : undefined;
}

function CanReload(State: FLauncherState): boolean
{
	return State.Clip < State.Settings.ClipSize;
}

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

function SpawnFireFx(Pawn: CSPlayerPawn, TemplateName: string): void
{
	if (TemplateName !== "")
	{
		SpawnTemporaryTemplate(TemplateName, Pawn.GetEyePosition(), FireFxLifetime);
	}
}

function SpawnReloadFx(Pawn: CSPlayerPawn, Settings: FLauncherSettings): void
{
	if (Settings.ReloadFxTemplate === "")
	{
		return;
	}
	const Spawned: Entity[] = SpawnTemporaryTemplate(Settings.ReloadFxTemplate, Pawn.GetEyePosition(), ReloadFxLifetime) ?? [];
	for (const Ent of Spawned)
	{
		if (Ent.GetParent() === undefined)
		{
			Ent.SetParent(Pawn);
		}
	}
}