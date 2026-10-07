import { Instance, CSInputs } from "cs_script/point_script";
import type { Entity, CSPlayerPawn, CSPlayerController, CustomHudLayout } from "cs_script/point_script";
import { LogPrefix, ForEachLivePawn } from "./bm_core";
import { EPlayerClass, ClassDefinitions } from "./bm_classes";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export type FClassMenuChoice = EPlayerClass | "close" | undefined;

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const ClassUiName: string = "class_hud";
const MenuPanelId: string = "ClassMenu";
const IndicatorPanelId: string = "ClassIndicator";
const ClassNameLabelId: string = "ClassName";
const PickButtonPrefix: string = "Pick_";
const CloseButtonId: string = "CloseMenu";
const MenuToggleKey: CSInputs = CSInputs.LOOK_AT_WEAPON;
const NoClassName: string = "No class";

const AllClasses: readonly EPlayerClass[] = Object.values(EPlayerClass);

const GOpenMenus: Set<number> = new Set<number>();
const GOfferedMenus: Set<number> = new Set<number>();
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

export function ShowClassIndicator(Slot: number, PlayerClass: EPlayerClass): void
{
	const Ui: CustomHudLayout | undefined = FindClassUi();
	if (!Ui)
	{
		return;
	}

	const DisplayName: string = PlayerClass === EPlayerClass.None ? NoClassName : ClassDefinitions[PlayerClass].Settings.DisplayName;
	Ui.SetDialogVariableStringForPlayer(Slot, ClassNameLabelId, "classname", DisplayName);
	Ui.SetHasClassForPlayer(Slot, IndicatorPanelId, "Shown", true);

	for (const Other of AllClasses)
	{
		const bIsCurrent: boolean = Other === PlayerClass;
		Ui.SetHasClassForPlayer(Slot, IndicatorPanelId, `Class_${Other}`, bIsCurrent);
		Ui.SetHasClassForPlayer(Slot, `${PickButtonPrefix}${Other}`, "Selected", bIsCurrent);
	}

	if (GOpenMenus.has(Slot))
	{
		Ui.SetHasClassForPlayer(Slot, MenuPanelId, "Open", true);
		Ui.SetInputCaptureEnabled(Slot, true);
	}
}

export function ResetClassUi(Slot: number): void
{
	GOpenMenus.delete(Slot);
	GOfferedMenus.delete(Slot);
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
