const HQ_RELATIONSHIP_TYPES = new Set(["HEADQUARTERS", "WAREHOUSE"]);
const CHAIN_STORE_RELATIONSHIP_TYPES = new Set(["DIRECT_STORE", "FRANCHISE_STORE"]);

export function getCurrentStoreRelationship(companyResponse, storeId) {
  const currentStoreId = Number(storeId || 0);
  if (!currentStoreId) return null;

  for (const company of companyResponse?.companies || []) {
    for (const store of company.stores || []) {
      if (Number(store.storeId) === currentStoreId) {
        return {
          company,
          store,
          relationshipType: store.relationshipType || null
        };
      }
    }
  }

  return null;
}

export function buildStoreOperationProfile(companyResponse, storeId) {
  const current = getCurrentStoreRelationship(companyResponse, storeId);
  const relationshipType = current?.relationshipType || "INDEPENDENT";
  const isHqStore = HQ_RELATIONSHIP_TYPES.has(relationshipType);
  const isChainStore = CHAIN_STORE_RELATIONSHIP_TYPES.has(relationshipType);
  const isIndependent = !current;

  return {
    relationshipType,
    isHqStore,
    isChainStore,
    isIndependent,
    canUseSuppliers: isHqStore || isIndependent,
    canUseStoreReplenishment: isChainStore,
    canUseInboundTransfers: isChainStore || isHqStore,
    canUseHqFeatures: isHqStore,
    company: current?.company || null,
    store: current?.store || null
  };
}

