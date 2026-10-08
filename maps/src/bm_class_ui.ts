import { Instance, CSInputs } from "cs_script/point_script";
import type { Entity, CSPlayerPawn, CSPlayerController, CustomHudLayout } from "cs_script/point_script";
import { LogPrefix, ForEachLivePawn } from "./bm_core";
import { EPlayerClass, ClassDefinitions } from "./bm_classes";
import type { FHudCounter } from "./bm_classes";
import type { FLauncherAmmo } from "./bm_launcher";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export type FClassMenuChoice = EPlayerClass | "close" | undefined;

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const ClassUiName: string = "class_hud";
const MenuPanelId: string = "ClassMenu";
const BottomBarId: string = "BottomBar";
const IndicatorPanelId: string = "ClassIndicator";
const ClassNameLabelId: string = "ClassName";
const PickButtonPrefix: string = "Pick_";
const CloseButtonId: string = "CloseMenu";
const MenuToggleKey: CSInputs = CSInputs.LOOK_AT_WEAPON;
const NoClassName: string = "No class";
const AmmoPanelId: string = "AmmoPanel";
const AmmoClipLabelId: string = "AmmoClip";
const AmmoSpareLabelId: string = "AmmoSpare";
const HealthPanelId: string = "HealthPanel";
const HealthValueLabelId: string = "HealthValue";
const HealthMaxLabelId: string = "HealthMax";
const CounterPanelId: string = "CounterPanel";
const CounterLabelId: string = "CounterLabel";
const CounterValueId: string = "CounterValue";
const CounterMaxId: string = "CounterMax";
const ChargeBarId: string = "ChargeBar";
const ChargeSteps: number = 10;               // the bar fills in this many steps: classes Charge_1 .. Charge_10
const HurtHealthFraction: number = 0.5;
const CriticalHealthFraction: number = 0.25;

const AllClasses: readonly EPlayerClass[] = Object.values(EPlayerClass);

const GOpenMenus: Set<number> = new Set<number>();
const GOfferedMenus: Set<number> = new Set<number>();
const GShownAmmo: Map<number, string> = new Map<number, string>();
const GShownHealth: Map<number, string> = new Map<number, string>();
const GShownCharge: Map<number, number> = new Map<number, number>();
const GShownCounter: Map<number, string> = new Map<number, string>();
let GbWarnedNoClassUi: boolean = false;

// Menu ////////////////////////////////////////////////////////////////////////////////////////////

export function OpenClassMenu(Slot: number): void
{
	const Ui: CustomHudLayout | undefined = FindClassUi();
	if (!Ui)
	{
		return;
	}
	GOpenMenus.add(Slot);
	Ui.SetHasClassForPlayer(Slot, MenuPanelId, "Open", true);
	Ui.SetInputCaptureEnabled(Slot, true);
}

export function CloseClassMenu(Slot: number): void
{
	GOpenMenus.delete(Slot);
	const Ui: CustomHudLayout | undefined = FindClassUi();
	if (!Ui)
	{
		return;
	}
	Ui.SetHasClassForPlayer(Slot, MenuPanelId, "Open", false);
	Ui.SetInputCaptureEnabled(Slot, false);
}

export function ToggleClassMenu(Slot: number): void
{
	if (GOpenMenus.has(Slot))
	{
		CloseClassMenu(Slot);
	}
	else
	{
		OpenClassMenu(Slot);
	}
}

export function OfferClassMenu(Slot: number, PlayerClass: EPlayerClass): void
{
	if (GOfferedMenus.has(Slot) || PlayerClass !== EPlayerClass.None)
	{
		return;
	}
	GOfferedMenus.add(Slot);
	OpenClassMenu(Slot);
}

export function TickClassMenuKey(): void
{
	ForEachLivePawn((Pawn: CSPlayerPawn, Slot: number): void =>
	{
		const Controller: CSPlayerController | undefined = Pawn.GetPlayerController();
		if (!Controller || Controller.IsBot())
		{
			return;
		}
		if (Pawn.WasInputJustPressed(MenuToggleKey))
		{
			ToggleClassMenu(Slot);
		}
	});
}

export function ReadClassMenuClick(Layout: CustomHudLayout, ButtonId: string): FClassMenuChoice
{
	if (Layout.GetEntityName() !== ClassUiName)
	{
		return undefined;
	}
	if (ButtonId === CloseButtonId)
	{
		return "close";
	}
	if (!ButtonId.startsWith(PickButtonPrefix))
	{
		return undefined;
	}
	const ClassValue: string = ButtonId.substring(PickButtonPrefix.length);
	for (const PlayerClass of AllClasses)
	{
		if (PlayerClass === ClassValue)
		{
			return PlayerClass;
		}
	}
	return undefined;
}

// Indicator ///////////////////////////////////////////////////////////////////////////////////////

export function ShowClassIndicator(Slot: number, PlayerClass: EPlayerClass, IsT: boolean): void
{
	const Ui: CustomHudLayout | undefined = FindClassUi();
	if (!Ui)
	{
		return;
	}

	const DisplayName: string = PlayerClass === EPlayerClass.None ? NoClassName : ClassDefinitions[PlayerClass].Settings.DisplayName;
	Ui.SetDialogVariableStringForPlayer(Slot, ClassNameLabelId, "classname", DisplayName);
	Ui.SetHasClassForPlayer(Slot, BottomBarId, "Shown", true);

	Ui.SetHasClassForPlayer(Slot, IndicatorPanelId, "Team_t", IsT);
	Ui.SetHasClassForPlayer(Slot, IndicatorPanelId, "Team_ct", !IsT);

	if (GOpenMenus.has(Slot))
	{
		Ui.SetHasClassForPlayer(Slot, MenuPanelId, "Open", true);
		Ui.SetInputCaptureEnabled(Slot, true);
	}
}

export function ShowAmmo(Slot: number, Ammo: FLauncherAmmo | undefined): void
{
	ShowCharge(Slot, Ammo ? Ammo.ChargeFraction : 0);

	const Key: string = Ammo ? `${Ammo.Clip}|${Ammo.bReloading}` : "";
	if ((GShownAmmo.get(Slot) ?? "") === Key)
	{
		return;
	}
	const Ui: CustomHudLayout | undefined = FindClassUi();
	if (!Ui)
	{
		return;
	}
	GShownAmmo.set(Slot, Key);

	if (!Ammo)
	{
		Ui.SetHasClassForPlayer(Slot, AmmoPanelId, "Shown", false);
		return;
	}
	Ui.SetDialogVariableStringForPlayer(Slot, AmmoClipLabelId, "ammoclip", `${Ammo.Clip}`);
	Ui.SetDialogVariableStringForPlayer(Slot, AmmoSpareLabelId, "ammospare", `${Ammo.MaxClip}`);
	Ui.SetHasClassForPlayer(Slot, AmmoPanelId, "Reloading", Ammo.bReloading);
	Ui.SetHasClassForPlayer(Slot, AmmoPanelId, "Empty", Ammo.Clip === 0);
	Ui.SetHasClassForPlayer(Slot, AmmoPanelId, "Shown", true);
}

// Charge bar under the crosshair, only while a launcher is charging
function ShowCharge(Slot: number, Fraction: number): void
{
	const Step: number = Fraction > 0 ? Math.min(ChargeSteps, Math.max(1, Math.ceil(Fraction * ChargeSteps))) : 0;
	const LastStep: number = GShownCharge.get(Slot) ?? 0;
	if (Step === LastStep)
	{
		return;
	}
	const Ui: CustomHudLayout | undefined = FindClassUi();
	if (!Ui)
	{
		return;
	}
	GShownCharge.set(Slot, Step);

	if (LastStep > 0)
	{
		Ui.SetHasClassForPlayer(Slot, ChargeBarId, `Charge_${LastStep}`, false);
	}
	if (Step > 0)
	{
		Ui.SetHasClassForPlayer(Slot, ChargeBarId, `Charge_${Step}`, true);
	}
	Ui.SetHasClassForPlayer(Slot, ChargeBarId, "Shown", Step > 0);
}

// A class's counter (e.g. stickies out) in the bottom bar, left of the ammo. undefined hides it.
export function ShowCounter(Slot: number, Counter: FHudCounter | undefined): void
{
	const Key: string = Counter ? `${Counter.Label}|${Counter.Count}|${Counter.Max}` : "";
	if ((GShownCounter.get(Slot) ?? "") === Key)
	{
		return;
	}
	const Ui: CustomHudLayout | undefined = FindClassUi();
	if (!Ui)
	{
		return;
	}
	GShownCounter.set(Slot, Key);

	if (!Counter)
	{
		Ui.SetHasClassForPlayer(Slot, CounterPanelId, "Shown", false);
		return;
	}
	Ui.SetDialogVariableStringForPlayer(Slot, CounterLabelId, "counterlabel", Counter.Label);
	Ui.SetDialogVariableStringForPlayer(Slot, CounterValueId, "countervalue", `${Counter.Count}`);
	Ui.SetDialogVariableStringForPlayer(Slot, CounterMaxId, "countermax", Counter.Max > 0 ? `/ ${Counter.Max}` : "");
	Ui.SetHasClassForPlayer(Slot, CounterPanelId, "HasAny", Counter.Count > 0);
	Ui.SetHasClassForPlayer(Slot, CounterPanelId, "Full", Counter.Max > 0 && Counter.Count >= Counter.Max);
	Ui.SetHasClassForPlayer(Slot, CounterPanelId, "Shown", true);
}

export function ShowHealth(Slot: number, Pawn: CSPlayerPawn | undefined): void
{
	const Health: number = Pawn ? Pawn.GetHealth() : 0;
	const MaxHealth: number = Pawn ? Math.max(1, Pawn.GetMaxHealth()) : 1;
	const Key: string = Pawn ? `${Health}|${MaxHealth}` : "";
	if ((GShownHealth.get(Slot) ?? "") === Key)
	{
		return;
	}
	const Ui: CustomHudLayout | undefined = FindClassUi();
	if (!Ui)
	{
		return;
	}
	GShownHealth.set(Slot, Key);

	if (!Pawn)
	{
		Ui.SetHasClassForPlayer(Slot, HealthPanelId, "Shown", false);
		return;
	}
	const Fraction: number = Health / MaxHealth;
	Ui.SetDialogVariableStringForPlayer(Slot, HealthValueLabelId, "health", `${Health}`);
	Ui.SetDialogVariableStringForPlayer(Slot, HealthMaxLabelId, "maxhealth", `${MaxHealth}`);
	Ui.SetHasClassForPlayer(Slot, HealthPanelId, "Overhealed", Health > MaxHealth);
	Ui.SetHasClassForPlayer(Slot, HealthPanelId, "Hurt", Fraction <= HurtHealthFraction && Fraction > CriticalHealthFraction);
	Ui.SetHasClassForPlayer(Slot, HealthPanelId, "Critical", Fraction <= CriticalHealthFraction);
	Ui.SetHasClassForPlayer(Slot, HealthPanelId, "Shown", true);
}

export function ResetClassUi(Slot: number): void
{
	GOpenMenus.delete(Slot);
	GOfferedMenus.delete(Slot);
	GShownAmmo.delete(Slot);
	GShownHealth.delete(Slot);
	GShownCharge.delete(Slot);
	GShownCounter.delete(Slot);
	const Ui: CustomHudLayout | undefined = FindClassUi();
	if (!Ui)
	{
		return;
	}
	Ui.SetInputCaptureEnabled(Slot, false);
	Ui.ResetForPlayer(Slot);
}

function FindClassUi(): CustomHudLayout | undefined
{
	const Ui: Entity | undefined = Instance.FindEntityByName(ClassUiName);
	if (IsCustomHudLayout(Ui))
	{
		return Ui;
	}
	if (!GbWarnedNoClassUi)
	{
		GbWarnedNoClassUi = true;
		const Problem: string = Ui ? "exists but isn't a custom_hud_layout" : "wasn't found";
		Instance.Msg(`${LogPrefix} class menu: an entity named "${ClassUiName}" ${Problem}. Check the custom_hud_layout in Hammer, then do a full map build.`);
	}
	return undefined;
}

function IsCustomHudLayout(Ent: Entity | undefined): Ent is CustomHudLayout
{
	return Ent !== undefined && "SetInputCaptureEnabled" in Ent && typeof Ent.SetInputCaptureEnabled === "function";
}