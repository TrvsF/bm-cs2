import { Instance, CSInputs } from "cs_script/point_script";
import type { CSPlayerPawn, CSWeaponBase } from "cs_script/point_script";
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
	readonly FireFxTemplate: string;
}

export interface FLauncherAmmo
{
	readonly Clip: number;
	readonly MaxClip: number;
	readonly bReloading: boolean;
	readonly ChargeFraction: number;
	readonly ReadyFraction: number;
}

interface FLauncherState
{
	readonly Settings: FLauncherSettings;
	readonly WeaponName: string;
	Clip: number;
	MaxClip: number;
	NextFireTime: number;
	NextReloadTime: number | undefined;
	ReloadWaitStart: number;
	ChargeStartTime: number | undefined;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const FireFxLifetime: number = 3;

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
		ReloadWaitStart: 0,
		ChargeStartTime: undefined,
	});
	GLaunchers.set(Slot, Launchers);
	EmptyRealGun(Pawn, WeaponName);
}

export function ClearLauncher(Slot: number): void
{
	GLaunchers.delete(Slot);
}

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
		const Weapon: CSWeaponBase | undefined = EmptyRealGun(Pawn, State.WeaponName);
		if (!Weapon || Active !== Weapon)
		{
			State.NextReloadTime = undefined;
			State.ChargeStartTime = undefined;
			continue;
		}
		if (TickHeldLauncher(Pawn, State, Now))
		{
			FiredWeapon = State.WeaponName;
		}
	}
	return FiredWeapon;
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
				ReadyFraction: GetReadyFraction(State),
			};
			return Ammo;
		}
	}
	return undefined;
}

function TickHeldLauncher(Pawn: CSPlayerPawn, State: FLauncherState, Now: number): boolean
{
	const bFireHeld: boolean = Pawn.IsInputPressed(CSInputs.ATTACK) && !Pawn.IsBuyMenuOpen() && !Instance.IsFreezePeriod();
	if (bFireHeld && State.Clip > 0)
	{
		State.NextReloadTime = undefined;
		if (Now < State.NextFireTime)
		{
			State.ChargeStartTime = undefined;
			return false;
		}
		if (State.Settings.ChargeTime > 0)
		{
			if (State.ChargeStartTime === undefined)
			{
				State.ChargeStartTime = Now;
			}
			if (Now - State.ChargeStartTime < State.Settings.ChargeTime)
			{
				return false;
			}
		}
		State.ChargeStartTime = undefined;
		State.Clip--;

		const bHeldThrough: boolean = Now - State.NextFireTime < TickInterval * 1.5;
		State.NextFireTime = (bHeldThrough ? State.NextFireTime : Now) + State.Settings.FireInterval;
		SpawnFireFx(Pawn, State.Settings);
		return true;
	}

	State.ChargeStartTime = undefined;
	TickReload(Pawn, State, Now);
	return false;
}

function GetChargeFraction(State: FLauncherState): number
{
	if (State.ChargeStartTime === undefined || State.Settings.ChargeTime <= 0)
	{
		return 0;
	}
	return Math.min(1, (Instance.GetGameTime() - State.ChargeStartTime) / State.Settings.ChargeTime);
}

function GetReadyFraction(State: FLauncherState): number
{
	const Now: number = Instance.GetGameTime();
	if (State.Clip > 0)
	{
		return GetWaitFraction(State.NextFireTime - State.Settings.FireInterval, State.NextFireTime, Now);
	}
	if (State.NextReloadTime === undefined)
	{
		return 0;
	}
	return GetWaitFraction(State.ReloadWaitStart, State.NextReloadTime, Now);
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
		State.NextReloadTime = Math.max(Now, State.NextFireTime) + State.Settings.ReloadFirstTime;
		State.ReloadWaitStart = Now < State.NextFireTime ? State.NextFireTime - State.Settings.FireInterval : Now;
		// }
		return;
	}

	if (Now < State.NextReloadTime)
	{
		return;
	}
	State.Clip = State.Settings.ReloadEachTime > 0 ? State.Clip + 1 : State.Settings.ClipSize;
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

function SpawnFireFx(Pawn: CSPlayerPawn, Settings: FLauncherSettings): void
{
	if (Settings.FireFxTemplate !== "")
	{
		SpawnTemporaryTemplate(Settings.FireFxTemplate, Pawn.GetEyePosition(), FireFxLifetime);
	}
}