// Types du domaine. Montants en centimes de roupie (entiers), dates en
// chaînes « AAAA-MM-JJ », mois « AAAA-MM », horodatages ISO 8601 en UTC.

/** Date calendaire « AAAA-MM-JJ », sans heure ni fuseau. */
export type IsoDate = string

/** Mois « AAAA-MM ». */
export type IsoMonth = string

/** Montant en centimes de roupie (entier). */
export type Cents = number

export type VarianceTreatment = 'pending' | 'impute_to_f1' | 'impute_to_f2' | 'split_50_50'

export const VARIANCE_TREATMENTS: readonly VarianceTreatment[] = ['pending', 'impute_to_f1', 'impute_to_f2', 'split_50_50']

/** Prix TTC d'une bonbonne à partir d'une date. */
export interface Price {
  id: string
  unitPriceCents: Cents
  effectiveFrom: IsoDate
}

/** Une bonbonne remplacée sur la fontaine du Foyer 1. */
export interface Replacement {
  id: string
  /** Horodatage ISO (UTC) du remplacement. */
  replacedAt: string
  note: string | null
  /** Livraison de rattachement ; null = en attente. */
  deliveryId: string | null
}

/** Passage du livreur Odezil. Foyer 2 = bottlesTotal − bottlesF1. */
export interface Delivery {
  id: string
  deliveryDate: IsoDate
  /** Total des bonbonnes remplacées par Odezil (les deux foyers). */
  bottlesTotal: number
  /** Remplacements du Foyer 1 rattachés (figé par l'attribution). */
  bottlesF1: number
  /** Prix figé à la création d'après le prix en vigueur à deliveryDate. */
  unitPriceCentsApplied: Cents
  documentPath: string | null
  note: string | null
}

/** Relevé mensuel Odezil (SOA). */
export interface SoaStatement {
  id: string
  month: IsoMonth
  totalBilledCents: Cents
  /** Total SOA − total attendu, figé à l'enregistrement. */
  varianceCents: Cents
  varianceTreatment: VarianceTreatment
  documentPath: string | null
  note: string | null
}

/** Remboursement reçu du Foyer 2. */
export interface Repayment {
  id: string
  repaymentDate: IsoDate
  amountCents: Cents
  note: string | null
}
