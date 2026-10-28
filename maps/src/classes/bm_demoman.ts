import { Instance, CSInputs } from "cs_script/point_script";
import type { CSPlayerPawn } from "cs_script/point_script";
import { bDebug, TickInterval, GetTeamColor, GetOrCreate } from "../bm_core";
import type { FColor } from "../bm_core";
import { LaunchProjectile, MoveProjectile, MoveBouncingProjectile, DrawMissingProjectile, DestroyProjectile, DestroyProjectiles, TintProjectile, Explode } from "../bm_combat";
import type { FProjectile, FBouncingProjectile, FBounceSettings, FDamageFalloff } from "../bm_combat";
import { TF2RocketFalloff, PlayerClass } from "../bm_classes";
import type { FClassSettings, FHudCounter } from "../bm_classes";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FDemoSettings extends FClassSettings
{
	readonly PipeLaunchSpeed: number,
	readonly PipeLaunchUp: number,
	readonly PipeRadius: number,
	readonly PipeDamage: number,
	readonly PipeRolledDamageScale: number,
	readonly PipeKnockback: number,
	readonly PipeFalloff: FDamageFalloff | undefined,
	readonly PipeFuseTime: number,
	readonly PipeBounce: FBounceSettings,
	readonly StickyDetonateKey: CSInputs;
	readonly StickyMax: number;
	readonly StickyArmTime: number;
	readonly StickyLaunchSpeed: number;
	readonly StickyLaunchUp: number;
	readonly StickyRadius: number;
	readonly StickyDamage: number;
	readonly StickyKnockback: number;
	readonly StickyFalloff: FDamageFalloff | undefined;
	readonly StickyFalloffTime: number;
}

export interface FPipe extends FBouncingProjectile
{
}

export interface FStickyBomb extends FProjectile
{
	bStuck: boolean;
	ArmedAt: number;
	bTintedArmed: boolean;
}

interface FDemoPlayerState
{
	Stickies: FStickyBomb[];
	bDetonateHeld: boolean;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const TF2StickyFalloff: FDamageFalloff = { RampUp: 1.1, FallOff: 0.9, OptimalDistance: 512 };

export const DemoSettings: FDemoSettings =
{
	DisplayName: "Exploder",
	PickFxTemplate: "demo_pick_template",
	Primary: "weapon_sawedoff",
	Secondary: "weapon_deagle",
	Melee: "",
	Health: 130,
	SizeScale: 1.2,
	PrimaryLauncher:
	{
		FireInterval: 0.6,
		ClipSize: 6,
		ReloadFirstTime: 1.09,
		ReloadEachTime: 0.67,
		ChargeTime: 0,
		DeployTime: 0.1,
		FireFxTemplate: "sticky_fire_template",
		ReloadFxTemplate: "sticky_reload_template",
	},
	SecondaryLauncher:
	{
		FireInterval: 0.6,
		ClipSize: 4,
		ReloadFirstTime: 1.24,
		ReloadEachTime: 0.6,
		ChargeTime: 0,
		DeployTime: 0.1,
		FireFxTemplate: "pipe_fire_template",
		ReloadFxTemplate: "pipe_reload_template",
	},
	
	StickyDetonateKey: CSInputs.ATTACK2,
	StickyMax: 6,
	StickyArmTime: 0.8,
	StickyLaunchSpeed: 900,
	StickyLaunchUp: 150,
	StickyRadius: 160,
	StickyDamage: 90,
	StickyKnockback: 600,
	StickyFalloff: TF2StickyFalloff,
	StickyFalloffTime: 5,
	PipeLaunchSpeed: 1337,
	PipeLaunchUp: 150,
	PipeRadius: 160,
	PipeDamage: 75,
	PipeRolledDamageScale: 0.6,
	PipeKnockback: 1000,
	PipeFalloff: TF2RocketFalloff,
	PipeFuseTime: 1.6,
	PipeBounce:
	{
		Restitution: 0.2,
		ImpactFriction: 0.5,
		RollFriction: 1200,
		SettleSpeed: 100,
	},
};

const StickyTemplateName: string = "sticky_template";
const PipeTemplateName: string = "pipe_template";
const UnarmedStickyColor: FColor = { r: 240, g: 240, b: 240 };

// Demoman /////////////////////////////////////////////////////////////////////////////////////////

export class DemomanClass extends PlayerClass<FDemoSettings>
{
	private PlayerStates: Map<number, FDemoPlayerState> = new Map<number, FDemoPlayerState>();
	private Pipes: FPipe[] = [];

	constructor()
	{
		super(DemoSettings);
	}

	public override OnPrimaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
		const Sticky: FStickyBomb =
		{
			...LaunchProjectile(Pawn, this.Settings.StickyLaunchSpeed, this.Settings.StickyLaunchUp, 1, StickyTemplateName),
			bStuck: false,
			ArmedAt: Now + this.Settings.StickyArmTime,
			bTintedArmed: false,
		};
		TintProjectile(Sticky, UnarmedStickyColor);

		const State: FDemoPlayerState = this.GetPlayerState(Slot);
		State.Stickies.push(Sticky);
		if (!bDebug)
		{
			while (State.Stickies.length > this.Settings.StickyMax)
			{
				const Oldest: FStickyBomb | undefined = State.Stickies.shift();
				if (Oldest)
				{
					DestroyProjectile(Oldest);
				}
			}
		}
	}

	public override OnSecondaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
		const Pipe: FPipe =
		{
			...LaunchProjectile(Pawn, this.Settings.PipeLaunchSpeed, this.Settings.PipeLaunchUp, 1, PipeTemplateName),
			bTouchedWorld: false,
			GroundNormal: undefined,
		};
		this.Pipes.push(Pipe);
	}

	public override TickWorld(Now: number, DeltaTime: number): void
	{
		this.Pipes = this.Pipes.filter((Pipe: FPipe): boolean =>
		{
			return this.StepPipe(Pipe, Now, DeltaTime);
		});
	}

	public override TickPlayer(Pawn: CSPlayerPawn, Slot: number, Now: number, DeltaTime: number): void
	{
		const State: FDemoPlayerState = this.GetPlayerState(Slot);
		for (const Sticky of State.Stickies)
		{
			if (!Sticky.bStuck && MoveProjectile(Sticky, DeltaTime, false))
			{
				Sticky.bStuck = true;
			}
		}

		for (const Sticky of State.Stickies)
		{
			const bArmed: boolean = Now >= Sticky.ArmedAt;
			if (Sticky.Models.length === 0)
			{
				Instance.DebugSphere({ center: Sticky.Position, radius: 4, duration: TickInterval * 2, color: bArmed ? GetTeamColor(Pawn) : UnarmedStickyColor });
			}
			else if (bArmed && !Sticky.bTintedArmed)
			{
				TintProjectile(Sticky, GetTeamColor(Pawn));
				Sticky.bTintedArmed = true;
			}
		}

		const bDown: boolean = Pawn.IsInputPressed(this.Settings.StickyDetonateKey);
		const bPressed: boolean = bDown && !State.bDetonateHeld;
		State.bDetonateHeld = bDown;
		if (!bPressed)
		{
			return;
		}

		const StillArming: FStickyBomb[] = [];
		for (const Sticky of State.Stickies)
		{
			if (Now < Sticky.ArmedAt)
			{
				StillArming.push(Sticky);
				continue;
			}
			DestroyProjectile(Sticky);
			const bYoungSticky: boolean = Now - Sticky.SpawnedAt < this.Settings.StickyFalloffTime;
			const RangeFalloff: FDamageFalloff | undefined = bYoungSticky ? this.Settings.StickyFalloff : undefined;
			Explode(Sticky.Position, Pawn, this.Settings.StickyRadius, this.Settings.StickyDamage, this.Settings.StickyKnockback, RangeFalloff);
		}
		State.Stickies = StillArming;
	}

	public override OnRoundStart(): void
	{
		for (const Slot of this.PlayerStates.keys())
		{
			this.ClearPlayer(Slot);
		}
		DestroyProjectiles(this.Pipes);
		this.Pipes = [];
	}

	public override ClearPlayer(Slot: number): void
	{
		const State: FDemoPlayerState | undefined = this.PlayerStates.get(Slot);
		if (!State)
		{
			return;
		}
		DestroyProjectiles(State.Stickies);
		this.PlayerStates.delete(Slot);
	}

	public override GetHudCounter(Slot: number): FHudCounter | undefined
	{
		const State: FDemoPlayerState | undefined = this.PlayerStates.get(Slot);
		return { Label: "Stickies", Count: State ? State.Stickies.length : 0, Max: bDebug ? 0 : this.Settings.StickyMax };
	}

	private GetPlayerState(Slot: number): FDemoPlayerState
	{
		return GetOrCreate(this.PlayerStates, Slot, (): FDemoPlayerState =>
		{
			return { Stickies: [], bDetonateHeld: false };
		});
	}

	private StepPipe(Pipe: FPipe, Now: number, DeltaTime: number): boolean
	{
		if (!Pipe.Owner.IsValid())
		{
			DestroyProjectile(Pipe);
			return false;
		}

		if (Now - Pipe.SpawnedAt >= this.Settings.PipeFuseTime || MoveBouncingProjectile(Pipe, DeltaTime, !Pipe.bTouchedWorld, this.Settings.PipeBounce))
		{
			this.DetonatePipe(Pipe);
			return false;
		}

		DrawMissingProjectile(Pipe);
		return true;
	}

	private DetonatePipe(Pipe: FPipe): void
	{
		DestroyProjectile(Pipe);
		const Damage: number = this.Settings.PipeDamage * (Pipe.bTouchedWorld ? this.Settings.PipeRolledDamageScale : 1);
		Explode(Pipe.Position, Pipe.Owner, this.Settings.PipeRadius, Damage, this.Settings.PipeKnockback, this.Settings.PipeFalloff);
	}
}