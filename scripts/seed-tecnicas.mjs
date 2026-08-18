import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Requer variável de ambiente GOOGLE_APPLICATION_CREDENTIALS apontando para o
// JSON da service account do projeto Firebase (não versionar esse arquivo).
initializeApp({ credential: applicationDefault() });

const db = getFirestore();

const TECNICAS = [
  {
    nome: "Fernanda Borba",
    email: "fernanda@smartgr.com.br",
    calendarId: "fernanda@smartgr.com.br",
    ativo: true,
    conectadoEm: null,
    refreshTokenEncrypted: null
  },
  {
    nome: "Mariana Cruz",
    email: "marianacruz@smartgr.com.br",
    calendarId: "marianacruz@smartgr.com.br",
    ativo: true,
    conectadoEm: null,
    refreshTokenEncrypted: null
  },
  {
    nome: "Vithoria Zanotti",
    email: "vithoria@smartgr.com.br",
    calendarId: "vithoria@smartgr.com.br",
    ativo: true,
    conectadoEm: null,
    refreshTokenEncrypted: null
  },
  {
    nome: "Eloah Ramos",
    email: "eloah@smartgr.com.br",
    calendarId: "eloah@smartgr.com.br",
    ativo: true,
    conectadoEm: null,
    refreshTokenEncrypted: null
  },
  {
    nome: "Julia Ruiz",
    email: "julia@smartgr.com.br",
    calendarId: "julia@smartgr.com.br",
    ativo: true,
    conectadoEm: null,
    refreshTokenEncrypted: null
  }
];

async function seed() {
  const batch = db.batch();

  for (const tecnica of TECNICAS) {
    const ref = db.collection('tecnicas').doc();
    batch.set(ref, {
      nome: tecnica.nome,
      email: tecnica.email,
      calendarId: tecnica.email,
      refreshTokenEncrypted: null,
      ativo: true,
      conectadoEm: null
    });
  }

  await batch.commit();
  console.log(`Seed concluído: ${TECNICAS.length} técnicas criadas.`);
}

seed().catch((err) => {
  console.error('Erro ao rodar seed:', err);
  process.exit(1);
});
