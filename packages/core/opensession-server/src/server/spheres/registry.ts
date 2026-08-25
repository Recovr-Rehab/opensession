import {
  SPHERE_PROVIDER_IDS,
  type SphereProvider,
  type SphereProviderId,
} from "./provider";

const VALID_PROVIDER_IDS = new Set<string>(SPHERE_PROVIDER_IDS);

export class UnknownSphereProviderError extends Error {
  constructor(providerId: string) {
    super(`unknown or unconfigured Sphere provider: ${providerId}`);
    this.name = "UnknownSphereProviderError";
  }
}

/** Explicit provider registry. It intentionally has no default provider. */
export class SphereProviderRegistry {
  readonly #providers = new Map<SphereProviderId, SphereProvider>();

  register(provider: SphereProvider): void {
    if (!VALID_PROVIDER_IDS.has(provider.id)) {
      throw new UnknownSphereProviderError(String(provider.id));
    }
    if (this.#providers.has(provider.id)) {
      throw new Error(`Sphere provider ${provider.id} is already registered`);
    }
    this.#providers.set(provider.id, provider);
  }

  get(providerId: SphereProviderId | string): SphereProvider {
    if (!VALID_PROVIDER_IDS.has(providerId)) {
      throw new UnknownSphereProviderError(providerId);
    }
    const provider = this.#providers.get(providerId as SphereProviderId);
    if (!provider) throw new UnknownSphereProviderError(providerId);
    return provider;
  }

  configured(): readonly SphereProviderId[] {
    return SPHERE_PROVIDER_IDS.filter((id) => this.#providers.has(id));
  }
}
