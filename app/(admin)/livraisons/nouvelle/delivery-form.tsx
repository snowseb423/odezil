"use client";

import { unstable_rethrow } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Camera, ImagePlus, X } from "lucide-react";
import { priceInEffect, type PriceSetting } from "@/lib/calculations";
import { MAX_BOTTLES, MAX_NOTE_LENGTH, PHOTO_BUCKET } from "@/lib/delivery-input";
import { HOUSEHOLD_A, HOUSEHOLD_B } from "@/lib/households";
import { MAX_UPLOAD_BYTES, preparePhoto } from "@/lib/image-client";
import { formatRs } from "@/lib/money";
import { createClient } from "@/lib/supabase/browser";
import { Stepper } from "@/components/stepper";
import { createDelivery } from "./actions";

const NETWORK_ERROR = "Connexion impossible. Vérifiez le réseau et réessayez : votre saisie est conservée.";

type DeliveryFormProps = {
  prices: PriceSetting[];
  today: string;
  defaultBottlesA: number;
  defaultBottlesB: number;
};

export function DeliveryForm({ prices, today, defaultBottlesA, defaultBottlesB }: DeliveryFormProps) {
  const [deliveryDate, setDeliveryDate] = useState(today);
  const [bottlesA, setBottlesA] = useState(defaultBottlesA);
  const [bottlesB, setBottlesB] = useState(defaultBottlesB);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const unitPrice = deliveryDate ? priceInEffect(prices, deliveryDate) : null;
  const amountA = unitPrice === null ? null : bottlesA * unitPrice;
  const amountB = unitPrice === null ? null : bottlesB * unitPrice;
  const canSubmit = !pending && unitPrice !== null && bottlesA + bottlesB > 0 && deliveryDate !== "";

  function onPhotoSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    setPhoto(file);
  }

  async function uploadPhoto(file: File): Promise<string> {
    const prepared = await preparePhoto(file);
    if (prepared.blob.size > MAX_UPLOAD_BYTES) {
      throw new Error("Photo trop lourde (5 Mo maximum).");
    }
    const path = `${deliveryDate.slice(0, 4)}/${crypto.randomUUID()}.${prepared.extension}`;
    const { error: uploadError } = await createClient()
      .storage.from(PHOTO_BUCKET)
      .upload(path, prepared.blob, { contentType: prepared.contentType, upsert: false });
    if (uploadError) {
      throw new Error("Envoi de la photo impossible. Réessayez ou enregistrez sans photo.");
    }
    return path;
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        const photoPath = photo ? await uploadPhoto(photo) : null;
        const result = await createDelivery({ deliveryDate, bottlesA, bottlesB, note, photoPath });
        // En cas de succès, l'action redirige vers l'accueil.
        if (result && !result.ok) setError(result.error);
      } catch (caught) {
        // Succès : createDelivery redirige (NEXT_REDIRECT), à laisser passer.
        unstable_rethrow(caught);
        setError(
          caught instanceof TypeError
            ? NETWORK_ERROR
            : caught instanceof Error
              ? caught.message
              : "Enregistrement impossible.",
        );
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="delivery-date">
          Date du bon
        </label>
        <input
          id="delivery-date"
          type="date"
          className="input"
          value={deliveryDate}
          max={today}
          required
          onChange={(event) => setDeliveryDate(event.target.value)}
        />
        <p className="mt-1.5 text-sm text-slate-600">
          {unitPrice === null
            ? "Aucun prix en vigueur à cette date."
            : `Prix unitaire : ${formatRs(unitPrice)} la bonbonne`}
        </p>
      </div>

      <Stepper
        label={HOUSEHOLD_A}
        value={bottlesA}
        onChange={setBottlesA}
        max={MAX_BOTTLES}
        hint={amountA === null ? undefined : formatRs(amountA)}
      />
      <Stepper
        label={HOUSEHOLD_B}
        value={bottlesB}
        onChange={setBottlesB}
        max={MAX_BOTTLES}
        hint={amountB === null ? undefined : formatRs(amountB)}
      />

      <div className="card">
        <p className="label">Photo du bon (facultatif)</p>
        {photo ? (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
            <span className="truncate text-sm text-slate-700">{photo.name || "Photo"}</span>
            <button
              type="button"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 active:bg-slate-200"
              onClick={() => setPhoto(null)}
              aria-label="Retirer la photo"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className="btn btn-secondary" onClick={() => cameraInput.current?.click()}>
              <Camera className="h-5 w-5" aria-hidden="true" />
              Photo
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => fileInput.current?.click()}>
              <ImagePlus className="h-5 w-5" aria-hidden="true" />
              Fichier
            </button>
          </div>
        )}
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onPhotoSelected}
        />
        <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={onPhotoSelected} />
      </div>

      <div>
        <label className="label" htmlFor="delivery-note">
          Note (facultatif)
        </label>
        <textarea
          id="delivery-note"
          className="input min-h-20 py-3 text-base"
          maxLength={MAX_NOTE_LENGTH}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="N° du bon, remarque…"
        />
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary w-full text-lg" disabled={!canSubmit}>
        {pending ? "Enregistrement…" : "Enregistrer la livraison"}
      </button>
    </form>
  );
}
