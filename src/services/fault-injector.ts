export type FaultMode =
  | 'NONE'
  | 'TRANSIENT_503'
  | 'PRE_MUTATION_TIMEOUT'
  | 'AMBIGUOUS_POST_COMMIT';

export interface InjectedFault {
  mode: FaultMode;
  targetOrderId?: string;
  triggeredCount: number;
}

/**
 * Controlled Server-Side Fault Injector
 * Operates strictly at the entitlement service boundary in test/operator environments.
 * Exercises genuine failure recovery and reconciliation without mocking database layers.
 */
class FaultInjector {
  private fault: InjectedFault = {
    mode: 'NONE',
    triggeredCount: 0,
  };

  /**
   * Configures an active fault injection mode.
   */
  public setFault(mode: FaultMode, targetOrderId?: string) {
    this.fault = {
      mode,
      targetOrderId,
      triggeredCount: 0,
    };
  }

  /**
   * Resets active fault injection.
   */
  public clearFault() {
    this.fault = {
      mode: 'NONE',
      triggeredCount: 0,
    };
  }

  /**
   * Returns current fault status.
   */
  public getStatus(): Readonly<InjectedFault> {
    return { ...this.fault };
  }

  /**
   * Evaluates and triggers pre-mutation faults (before DB insert).
   */
  public checkPreMutation(orderId: string) {
    if (this.fault.mode === 'NONE') return;
    if (this.fault.targetOrderId && this.fault.targetOrderId !== orderId) return;

    if (this.fault.mode === 'TRANSIENT_503') {
      this.fault.triggeredCount++;
      throw new Error('[FaultInjector: TRANSIENT_503] Simulated downstream service unavailable HTTP 503');
    }

    if (this.fault.mode === 'PRE_MUTATION_TIMEOUT') {
      this.fault.triggeredCount++;
      throw new Error('[FaultInjector: PRE_MUTATION_TIMEOUT] Simulated connection timed out before database mutation');
    }
  }

  /**
   * Evaluates and triggers post-mutation faults (after DB commit, before acknowledgment).
   */
  public checkPostCommit(orderId: string) {
    if (this.fault.mode === 'NONE') return;
    if (this.fault.targetOrderId && this.fault.targetOrderId !== orderId) return;

    if (this.fault.mode === 'AMBIGUOUS_POST_COMMIT') {
      this.fault.triggeredCount++;
      throw new Error('[FaultInjector: AMBIGUOUS_POST_COMMIT] Database committed, but transport dropped before client acknowledgment');
    }
  }
}

export const faultInjector = new FaultInjector();
