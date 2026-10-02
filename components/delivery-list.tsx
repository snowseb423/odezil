import { Camera, Trash2 } from "lucide-react";
import { deleteDelivery } from "@/app/(admin)/livraisons/nouvelle/actions";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { deliveryShareA, deliveryShareB } from "@/lib/calculations";
import type { DeliveryRecord } from "@/lib/data/admin";
import { formatDateFr } from "@/lib/dates";
import { HOUSEHOLD_A, HOUSEHOLD_B } from "@/lib/households";
import { formatRs } from "@/lib/money";

type DeliveryListProps = {
  deliveries: DeliveryRecord[];
  allowDelete?: boolean;
};

export function DeliveryList({ deliveries, allowDelete = false }: DeliveryListProps) {
  if (deliveries.length === 0) {
    return <p className="text-slate-600">Aucune livraison.</p>;
  }

  return (
    <ul className="divide-y divide-slate-100">
      {deliveries.map((delivery) => {
        return (
          <li key={delivery.id} className="py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{formatDateFr(delivery.deliveryDate)}</p>
                <p className="text-sm text-slate-600 tabular-nums">
                  {HOUSEHOLD_A} {delivery.bottlesA} · {HOUSEHOLD_B} {delivery.bottlesB} · {formatRs(delivery.unitPriceCentsApplied)}
                  /u
                </p>
                <p className="text-sm text-slate-600 tabular-nums">
                  {formatRs(deliveryShareA(delivery))} · <span className="font-medium text-slate-900">{formatRs(deliveryShareB(delivery))}</span>
                </p>
                {delivery.note && <p className="mt-1 text-sm text-slate-500 italic">{delivery.note}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {delivery.photoPath && (
                  <a
                    href={`/photos/${delivery.id}`}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-sky-700 active:bg-sky-50"
                    aria-label="Voir la photo du bon"
                  >
                    <Camera className="h-5 w-5" aria-hidden="true" />
                  </a>
                )}
                {allowDelete && (
                  <form action={deleteDelivery}>
                    <input type="hidden" name="id" value={delivery.id} />
                    <ConfirmSubmit
                      label="Supprimer la livraison"
                      message={`Supprimer la livraison du ${formatDateFr(delivery.deliveryDate)} ?`}
                      className="flex h-11 w-11 items-center justify-center rounded-full text-slate-500 active:bg-red-50 active:text-red-700"
                    >
                      <Trash2 className="h-5 w-5" aria-hidden="true" />
                    </ConfirmSubmit>
                  </form>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
