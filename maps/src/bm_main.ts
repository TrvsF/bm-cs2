import { Instance, CSDamageTypes, CSGearSlot } from "cs_script/point_script";
import type { CSPlayerPawn, CSPlayerController, CSWeaponBase } from "cs_script/point_script";
import { bDebug, TickInterval, LogPrefix, INDEX_NONE, GetPlayerSlot, IsWeapon, SetTimer, TickTimers, ForEachLivePawn } from "./bm_core";
import type
{
	FPlayerChatEvent,
	FPlayerResetEvent,
	FPlayerKillEvent,
	FPlayerDisconnectEvent,
	FGunFireEvent,
	FWeaponPickupEvent,
	FWeaponDropEvent,
	FPlayerDamageEvent,
	FCustomHudClickedEvent,
	FModifyDamageEvent,
	FModifyDamageResult,
} from "./bm_core";
import { EPlayerClass, ClassDefinitions, GiveLoadout, GiveNoClassLoadout, IsWeaponAllowed, RestoreDefaultBody } from "./bm_classes";
import type { EPlayableClass } from "./bm_classes";
import { ClearDecals } from "./bm_effects";
import { ShowDamageNumber, ResetDamageNumbers } from "./bm_hud";
import { TickBots, ResetBotMode, ForgetBot } from "./bm_bots";
import { OpenClassMenu, CloseClassMenu, OfferClassMenu, TickClassMenuKey, ReadClassMenuClick, ShowClassIndicator, ShowAmmo, ShowHealth, ResetClassUi } from "./bm_class_ui";
import { TickLauncher, ClearLauncher, GetLauncherAmmo } from "./bm_launcher";
import type { FClassMenuChoice } from "./bm_class_ui";

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const ClassChatCommands: ReadonlyMap<string, EPlayerClass> = new Map<string, EPlayerClass>(
	[
		["!demo", EPlayerClass.Demoman],
		["!medic", EPlayerClass.Medic],
		["!solider", EPlayerClass.Solider],
		["!none", EPlayerClass.None],
	]
);

// Main ///////////////////////////////////////////////////////////////////////////////////////////

function Tick(): void
{
	const Now: number = Instance.GetGameTime();
	Instance.SetNextThink(Now + TickInterval);
	const DeltaTime: number = Math.min(0.1, Math.max(0, Now - GLastThinkTime)) || TickInterval;
	GLastThinkTime = Now;

	try
	{
		TickMatch(Now);
		TickTimers(Now);

		for (const Definition of Object.values(ClassDefinitions))
		{
			Definition.TickWorld(Now, DeltaTime);
		}
		ForEachLivePawn((Pawn: CSPlayerPawn, Slot: number): void =>
		{
			const PlayerClass: EPlayableClass | undefined = GClassBySlot.get(Slot);
			if (PlayerClass !== undefined)
			{
				const Definition = ClassDefinitions[PlayerClass];
				const FiredWeapon: string | undefined = TickLauncher(Pawn, Slot, Now);
				if (FiredWeapon === Definition.Settings.Primary)
				{
					Definition.OnPrimaryFire(Pawn, Slot, Now);
				}
				else if (FiredWeapon === Definition.Settings.Secondary)
				{
					Definition.OnSecondaryFire(Pawn, Slot, Now);
				}
				Definition.TickPlayer(Pawn, Slot, Now, DeltaTime);
			}
		});
		for (const Definition of Object.values(ClassDefinitions))
		{
			Definition.TickWorldLate(Now, DeltaTime);
		}

		TickClassMenuKey();
		TickPlayerHud();
		TickNoBuying();
		TickBots(Now);
	}
	catch (Exception: unknown)
	{
		Instance.Msg(`${LogPrefix} error: ${String(Exception)}`);
	}
}

function BeginPlay(): void
{
	Instance.OnPlayerChat(HandlePlayerChat);
	Instance.OnPlayerReset(HandlePlayerReset);
	Instance.OnPlayerKill(HandlePlayerKill);
	Instance.OnPlayerDisconnect(HandlePlayerDisconnect);
	Instance.OnRoundStart(HandleRoundStart);
	Instance.OnGunFire(HandleGunFire);
	Instance.OnWeaponPickup(HandleWeaponPickup);
	Instance.OnWeaponDrop(HandleWeaponDrop);
	Instance.OnPlayerDamage(HandlePlayerDamage);
	Instance.OnModifyPlayerDamage(HandleModifyPlayerDamage);
	Instance.OnCustomHudClicked(HandleCustomHudClicked);

	Instance.SetThink(Tick);
	Instance.SetNextThink(Instance.GetGameTime());
	Instance.Msg(`${LogPrefix} loaded${bDebug ? " (DEBUG on)" : ""}`);
}

BeginPlay(); // !

// Handle /////////////////////////////////////////////////////////////////////////////////////////

function HandlePlayerChat(Event: FPlayerChatEvent): void
{
	const Player: CSPlayerController | undefined = Event.player;
	if (!Player)
	{
		return;
	}

	const Command: string = Event.text.trim().toLowerCase();
	if (bDebug && Command === "!hudtest")
	{
		ShowDamageNumber(Player.GetPlayerSlot(), 123);
		return;
	}
	if (Command === "!class")
	{
		OpenClassMenu(Player.GetPlayerSlot());
		return;
	}

	const PlayerClass: EPlayerClass | undefined = ClassChatCommands.get(Command);
	if (PlayerClass !== undefined)
	{
		RequestPlayerClass(Player, PlayerClass);
	}
}

function HandlePlayerReset(Event: FPlayerResetEvent): void
{
	const Pawn: CSPlayerPawn = Event.player;
	const Slot: number = GetPlayerSlot(Pawn);
	if (Slot === INDEX_NONE)
	{
		return;
	}

	ClearPlayer(Slot);
	ResetBotMode(Slot);
	const bHadClass: boolean = GClassBySlot.has(Slot);
	ApplyPendingClass(Slot);
	RefreshClassUi(Pawn, Slot);
	const PlayerClass: EPlayableClass | undefined = GClassBySlot.get(Slot);

	SetTimer(0.1, (): void =>
	{
		if (!Pawn.IsValid() || !Pawn.IsAlive())
		{
			return;
		}
		if (PlayerClass === undefined)
		{
			if (bHadClass)
			{
				RestoreDefaultBody(Pawn);
			}
			GiveNoClassLoadout(Pawn);
		}
		else
		{
			GiveLoadout(Pawn, PlayerClass);
		}
	});
}

function HandlePlayerKill(Event: FPlayerKillEvent): void
{
	const Slot: number = GetPlayerSlot(Event.player);
	if (Slot !== INDEX_NONE)
	{
		ClearPlayer(Slot);
	}
}

function HandlePlayerDisconnect(Event: FPlayerDisconnectEvent): void
{
	ClearPlayer(Event.playerSlot);
	ForgetBot(Event.playerSlot);
	ResetDamageNumbers(Event.playerSlot);
	ResetClassUi(Event.playerSlot);
	GClassBySlot.delete(Event.playerSlot);
	GPendingClassBySlot.delete(Event.playerSlot);
}

function HandleRoundStart(): void
{
	for (const Definition of Object.values(ClassDefinitions))
	{
		Definition.OnRoundStart();
	}
	ClearDecals();
	ApplyMatchSettings();
	Instance.Msg(`${LogPrefix} match settings applied`);
}

function HandleGunFire(Event: FGunFireEvent): void
{
	const Weapon: CSWeaponBase = Event.weapon;
	const Pawn: CSPlayerPawn | undefined = Weapon.GetOwner();
	const Slot: number = GetPlayerSlot(Pawn);
	const PlayerClass: EPlayableClass | undefined = GClassBySlot.get(Slot);
	if (!Pawn || PlayerClass === undefined)
	{
		return;
	}

	const Definition = ClassDefinitions[PlayerClass];
	if (IsWeapon(Weapon, Definition.Settings.Primary) && !Definition.Settings.PrimaryLauncher)
	{
		Definition.OnPrimaryFire(Pawn, Slot, Instance.GetGameTime());
	}
	else if (IsWeapon(Weapon, Definition.Settings.Secondary) && !Definition.Settings.SecondaryLauncher)
	{
		Definition.OnSecondaryFire(Pawn, Slot, Instance.GetGameTime());
	}
}

function HandleWeaponPickup(Event: FWeaponPickupEvent): void
{
	const Weapon: CSWeaponBase = Event.weapon;
	SetTimer(0, (): void =>
	{
		RemoveIfNotAllowed(Weapon);
	});
}

function HandleWeaponDrop(Event: FWeaponDropEvent): void
{
	const Weapon: CSWeaponBase = Event.weapon;
	const Dropper: CSPlayerPawn = Event.dropper;
	SetTimer(0, (): void =>
	{
		RemoveDeathDrop(Weapon, Dropper);
	});
}

function HandlePlayerDamage(Event: FPlayerDamageEvent): void
{
	const AttackerSlot: number = GetPlayerSlot(Event.attacker);
	if (AttackerSlot === INDEX_NONE || Event.attacker === Event.player)
	{
		return;
	}
	ShowDamageNumber(AttackerSlot, Event.damage);
}

function HandleCustomHudClicked(Event: FCustomHudClickedEvent): void
{
	const Choice: FClassMenuChoice = ReadClassMenuClick(Event.layout, Event.buttonId);
	if (Choice === undefined)
	{
		return;
	}

	CloseClassMenu(Event.player.GetPlayerSlot());
	if (Choice !== "close")
	{
		RequestPlayerClass(Event.player, Choice);
	}
}

function HandleModifyPlayerDamage(Event: FModifyDamageEvent): FModifyDamageResult
{
	for (const Definition of Object.values(ClassDefinitions))
	{
		const Result: FModifyDamageResult = Definition.ModifyAnyDamage(Event);
		if (Result)
		{
			return Result;
		}
	}

	// fall-damage
	if ((Event.damageTypes & CSDamageTypes.FALL) !== 0 && GClassBySlot.has(GetPlayerSlot(Event.player)))
	{
		// const FallSpeed: number = 580 + Event.damage * (1024 - 580) / 100; // undoes cs2's fall formula
		// if (FallSpeed <= 650)
		// {
		// 	return { abort: true };
		// }
		// return { damage: Math.round(5 * (FallSpeed / 300) * (Event.player.GetMaxHealth() / 100)) };

		return { abort: true };
	}

	const AttackerSlot: number = GetPlayerSlot(Event.attacker);
	const AttackerClass: EPlayableClass | undefined = GClassBySlot.get(AttackerSlot);
	if (AttackerClass === undefined)
	{
		return;
	}

	return ClassDefinitions[AttackerClass].ModifyOutgoingDamage(Event);
}

// Globals ////////////////////////////////////////////////////////////////////////////////////////

const GClassBySlot: Map<number, EPlayableClass> = new Map<number, EPlayableClass>();
const GPendingClassBySlot: Map<number, EPlayerClass> = new Map<number, EPlayerClass>();
let GLastThinkTime: number = 0;

// Match //////////////////////////////////////////////////////////////////////////////////////////

function ApplyMatchSettings(): void
{
	const Commands: string[] = [];

	if (bDebug)
	{
		Commands.push("mp_do_warmup_period 0", "mp_warmuptime 0", "mp_freezetime 0");
		Commands.push("mp_roundtime 60", "mp_roundtime_defuse 60", "mp_roundtime_hostage 60");
		Commands.push("mp_ignore_round_win_conditions 1", "mp_respawn_on_death_t 1", "mp_respawn_on_death_ct 1");
		Commands.push("sv_infinite_ammo 1");
		Commands.push("bot_quota_mode fill", "bot_quota 8", "bot_join_team any", "bot_stop 1");
	}

	for (const Command of Commands)
	{
		Instance.ServerCommand(Command);
	}
}

function TickMatch(Now: number): void
{
	if (bDebug && Instance.IsWarmupPeriod())
	{
		Instance.ServerCommand("mp_warmup_end");
	}
}

// Player //////////////////////////////////////////////////////////////////////////////////////////

function RequestPlayerClass(Player: CSPlayerController, PlayerClass: EPlayerClass): void
{
	const Slot: number = Player.GetPlayerSlot();
	const CurrentClass: EPlayerClass = GClassBySlot.get(Slot) ?? EPlayerClass.None;
	const Pawn: CSPlayerPawn | undefined = Player.GetPlayerPawn();
	const bAlive: boolean = Pawn !== undefined && Pawn.IsValid() && Pawn.IsAlive();

	if (!bAlive || CurrentClass === EPlayerClass.None)
	{
		GPendingClassBySlot.delete(Slot);
		SetPlayerClass(Player, PlayerClass);
		return;
	}

	if (PlayerClass === CurrentClass)
	{
		GPendingClassBySlot.delete(Slot);
	}
	else
	{
		GPendingClassBySlot.set(Slot, PlayerClass);
	}
	ShowClassIndicator(Slot, CurrentClass, Pawn?.GetTeamNumber() === 2);
	Instance.Msg(`${LogPrefix} ${Player.GetPlayerName()} -> ${PlayerClass} on respawn`);
}

function ApplyPendingClass(Slot: number): void
{
	const NextClass: EPlayerClass | undefined = GPendingClassBySlot.get(Slot);
	if (NextClass === undefined)
	{
		return;
	}

	GPendingClassBySlot.delete(Slot);
	if (NextClass === EPlayerClass.None)
	{
		GClassBySlot.delete(Slot);
	}
	else
	{
		GClassBySlot.set(Slot, NextClass);
	}
}

function SetPlayerClass(Player: CSPlayerController, PlayerClass: EPlayerClass): void
{
	const Slot: number = Player.GetPlayerSlot();
	ClearPlayer(Slot);

	const Pawn: CSPlayerPawn | undefined = Player.GetPlayerPawn();
	if (PlayerClass === EPlayerClass.None)
	{
		GClassBySlot.delete(Slot);
		if (Pawn && Pawn.IsAlive())
		{
			RestoreDefaultBody(Pawn);
			GiveNoClassLoadout(Pawn);
		}
	}
	else
	{
		GClassBySlot.set(Slot, PlayerClass);
		if (Pawn && Pawn.IsAlive())
		{
			GiveLoadout(Pawn, PlayerClass);
		}
	}
	ShowClassIndicator(Slot, PlayerClass, Pawn?.GetTeamNumber() === 2);

	const ClassLabel: string = PlayerClass === EPlayerClass.None ? "normal" : PlayerClass;
	Instance.Msg(`${LogPrefix} ${Player.GetPlayerName()} -> ${ClassLabel}`);
}

function RefreshClassUi(Pawn: CSPlayerPawn, Slot: number): void
{
	const Controller: CSPlayerController | undefined = Pawn.GetPlayerController();
	if (!Controller || Controller.IsBot())
	{
		return;
	}

	const PlayerClass: EPlayerClass = GClassBySlot.get(Slot) ?? EPlayerClass.None;
	ShowClassIndicator(Slot, PlayerClass, Pawn?.GetTeamNumber() === 2);
	SetTimer(0.5, (): void =>
	{
		if (Pawn.IsValid() && Pawn.IsAlive())
		{
			OfferClassMenu(Slot, GClassBySlot.get(Slot) ?? EPlayerClass.None);
		}
	});
}

function ClearPlayer(Slot: number): void
{
	for (const Definition of Object.values(ClassDefinitions))
	{
		Definition.ClearPlayer(Slot);
	}
	ClearLauncher(Slot);
	ShowAmmo(Slot, undefined);
	ShowHealth(Slot, undefined);
}

function TickPlayerHud(): void
{
	ForEachLivePawn((Pawn: CSPlayerPawn, Slot: number): void =>
	{
		const Controller: CSPlayerController | undefined = Pawn.GetPlayerController();
		if (Controller && !Controller.IsBot())
		{
			ShowHealth(Slot, Pawn);
			ShowAmmo(Slot, GetLauncherAmmo(Pawn, Slot));
		}
	});
}

// Weapons /////////////////////////////////////////////////////////////////////////////////////////

function RemoveIfNotAllowed(Weapon: CSWeaponBase): void
{
	if (!Weapon.IsValid())
	{
		return;
	}
	const Pawn: CSPlayerPawn | undefined = Weapon.GetOwner();
	const Slot: number = GetPlayerSlot(Pawn);
	if (!Pawn || Slot === INDEX_NONE || !Pawn.IsAlive())
	{
		return;
	}

	const PlayerClass: EPlayerClass = GClassBySlot.get(Slot) ?? EPlayerClass.None;
	if (IsWeaponAllowed(PlayerClass, Weapon))
	{
		return;
	}
	Pawn.DestroyWeapon(Weapon);

	SetTimer(0, (): void =>
	{
		EnsureWeaponInHand(Pawn);
	});
}

function RemoveDeathDrop(Weapon: CSWeaponBase, Dropper: CSPlayerPawn): void
{
	if (!Weapon.IsValid() || Weapon.GetOwner())
	{
		return;
	}
	if (Dropper.IsValid() && Dropper.IsAlive())
	{
		return;
	}
	Weapon.Remove();
}

function EnsureWeaponInHand(Pawn: CSPlayerPawn): void
{
	if (!Pawn.IsValid() || !Pawn.IsAlive())
	{
		return;
	}
	const Active: CSWeaponBase | undefined = Pawn.GetActiveWeapon();
	if (Active && Active.IsValid())
	{
		return;
	}
	for (const GearSlot of [CSGearSlot.RIFLE, CSGearSlot.PISTOL, CSGearSlot.KNIFE])
	{
		const Weapon: CSWeaponBase | undefined = Pawn.FindWeaponBySlot(GearSlot);
		if (Weapon)
		{
			Pawn.SwitchToWeapon(Weapon);
			return;
		}
	}
}

function TickNoBuying(): void
{
	ForEachLivePawn((Pawn: CSPlayerPawn): void =>
	{
		const Controller: CSPlayerController | undefined = Pawn.GetPlayerController();
		if (!Controller)
		{
			return;
		}
		const Money: number = Controller.GetMoneySpendableNow();
		if (Money > 0)
		{
			Controller.AddMoneySpendableNow(-Money);
		}
	});
}