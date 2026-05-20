import axios from 'axios';
import type { EntrepriseInfo } from '@devisvocal/types';

// ─── Google Maps Places API ───────────────────────────────────────────────────

export async function searchEntrepriseByName(
  nom: string,
  pays = 'CH'
): Promise<EntrepriseInfo | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  try {
    const url = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
    const res = await axios.get<GooglePlacesResponse>(url, {
      params: {
        query: nom,
        region: pays.toLowerCase(),
        key: apiKey,
      },
    });

    const place = res.data.results?.[0];
    if (!place) return null;

    return {
      nom: place.name,
      adresse: place.formatted_address,
      source: 'google_maps',
    };
  } catch {
    return null;
  }
}

// ─── API Sirene INSEE (gratuit) ───────────────────────────────────────────────

export async function searchEntrepriseBySiret(siret: string): Promise<EntrepriseInfo | null> {
  // API officielle INSEE — gratuit, pas de clé requise pour les établissements publics
  // Pour les entreprises suisses, on utilise le Registre du Commerce (RC)
  // En Suisse, pas d'API publique équivalente → on retourne null et laisse l'artisan corriger
  try {
    // France : API Sirene INSEE
    const cleanSiret = siret.replace(/\s/g, '');
    const url = `https://api.insee.fr/entreprises/sirene/V3.11/siret/${cleanSiret}`;
    const res = await axios.get<SireneResponse>(url, {
      headers: { Authorization: `Bearer ${process.env.INSEE_API_TOKEN ?? ''}` },
    });

    const etab = res.data.etablissement;
    if (!etab) return null;

    const adresse = [
      etab.adresseEtablissement?.numeroVoieEtablissement,
      etab.adresseEtablissement?.typeVoieEtablissement,
      etab.adresseEtablissement?.libelleVoieEtablissement,
      etab.adresseEtablissement?.codePostalEtablissement,
      etab.adresseEtablissement?.libelleCommuneEtablissement,
    ]
      .filter(Boolean)
      .join(' ');

    const activite =
      etab.uniteLegale?.activitePrincipaleUniteLegale ?? undefined;

    return {
      nom: etab.uniteLegale?.denominationUniteLegale ?? etab.uniteLegale?.nomUniteLegale ?? nom,
      siret: cleanSiret,
      adresse,
      activite,
      source: 'sirene',
    };
  } catch {
    return null;
  }
}

// ─── Types internes ───────────────────────────────────────────────────────────

interface GooglePlacesResponse {
  results: Array<{
    name: string;
    formatted_address: string;
    place_id: string;
  }>;
  status: string;
}

interface SireneResponse {
  etablissement: {
    siret: string;
    uniteLegale?: {
      denominationUniteLegale?: string;
      nomUniteLegale?: string;
      activitePrincipaleUniteLegale?: string;
    };
    adresseEtablissement?: {
      numeroVoieEtablissement?: string;
      typeVoieEtablissement?: string;
      libelleVoieEtablissement?: string;
      codePostalEtablissement?: string;
      libelleCommuneEtablissement?: string;
    };
  };
}
