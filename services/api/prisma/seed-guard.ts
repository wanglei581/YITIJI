export const DEMO_SEED_CONFIRMATION = 'I_UNDERSTAND_DEMO_DATA_WILL_BE_WRITTEN'

type DemoSeedEnv = Pick<NodeJS.ProcessEnv, 'NODE_ENV' | 'DEMO_SEED_CONFIRM'>

export function assertDemoSeedAllowed(env: DemoSeedEnv): void {
  if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
    throw new Error('DEMO_SEED_ENV_FORBIDDEN: NODE_ENV must be development or test')
  }

  if (env.DEMO_SEED_CONFIRM !== DEMO_SEED_CONFIRMATION) {
    throw new Error(
      `DEMO_SEED_CONFIRMATION_REQUIRED: set DEMO_SEED_CONFIRM=${DEMO_SEED_CONFIRMATION}`
    )
  }
}
