import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type Timestamp,
} from 'firebase/firestore';
import type { Project, ProjectConfig, ProjectSummary } from '@sign-mesh-maker/shared';
import { db } from './firebase';

/** Firestore's hard per-document ceiling (requirements §6). */
export const FIRESTORE_DOC_LIMIT = 1_048_576;

/**
 * Refuse a save above this rather than at the hard limit.
 *
 * The estimate below counts the payload strings, not field names, the document
 * path, index entries or timestamp overhead. Saving at 1,048,575 bytes would be
 * rejected by the server with an error the user cannot act on, so the headroom
 * buys a message that says what to do instead.
 */
export const SAFE_DOC_BUDGET = 900_000;

export class ProjectTooLargeError extends Error {}
export class NotSignedInError extends Error {}

const encoder = new TextEncoder();

/** Approximate stored size of the parts that can actually grow. */
export function estimateProjectSize(input: {
  svg: string;
  thumbnailDataUrl: string;
  config: ProjectConfig;
  name: string;
}): number {
  return (
    encoder.encode(input.svg).length +
    encoder.encode(input.thumbnailDataUrl).length +
    encoder.encode(JSON.stringify(input.config)).length +
    encoder.encode(input.name).length
  );
}

function requireDb() {
  if (!db) {
    throw new NotSignedInError('Saving is unavailable: this deployment has no Firebase configuration.');
  }
  return db;
}

/** Firestore timestamps arrive as objects; the domain type wants milliseconds. */
function toMillis(value: unknown): number {
  const timestamp = value as Timestamp | undefined;
  return typeof timestamp?.toMillis === 'function' ? timestamp.toMillis() : 0;
}

function toSummary(id: string, data: DocumentData): ProjectSummary {
  return {
    id,
    ownerUid: data.ownerUid,
    name: data.name ?? 'Untitled',
    thumbnailDataUrl: data.thumbnailDataUrl ?? '',
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

/**
 * Projects owned by `uid`, newest first.
 *
 * The ownerUid + updatedAt ordering is what firestore.indexes.json declares;
 * changing either half of it needs a matching index change or the query fails
 * at runtime rather than at build time.
 */
export async function listProjects(uid: string, max = 60): Promise<ProjectSummary[]> {
  const store = requireDb();
  const snapshot = await getDocs(
    query(
      collection(store, 'projects'),
      where('ownerUid', '==', uid),
      orderBy('updatedAt', 'desc'),
      limit(max),
    ),
  );
  return snapshot.docs.map((entry) => toSummary(entry.id, entry.data()));
}

export async function loadProject(id: string): Promise<Project | null> {
  const store = requireDb();
  const snapshot = await getDoc(doc(store, 'projects', id));
  if (!snapshot.exists()) return null;

  const data = snapshot.data();
  return {
    ...toSummary(snapshot.id, data),
    svg: data.svg ?? '',
    config: data.config as ProjectConfig,
  };
}

export interface SaveProjectInput {
  /** Omitted for a new project; supplied to overwrite an existing one. */
  id?: string;
  ownerUid: string;
  name: string;
  svg: string;
  thumbnailDataUrl: string;
  config: ProjectConfig;
}

export async function saveProject(input: SaveProjectInput): Promise<string> {
  const store = requireDb();

  const size = estimateProjectSize(input);
  if (size > SAFE_DOC_BUDGET) {
    throw new ProjectTooLargeError(
      `This project is about ${Math.round(size / 1024)} KB, over the ${Math.round(
        SAFE_DOC_BUDGET / 1024,
      )} KB a single record can hold. Reduce the number of layers or simplify the artwork, then save again.`,
    );
  }

  const ref = input.id
    ? doc(store, 'projects', input.id)
    : doc(collection(store, 'projects'));

  await setDoc(
    ref,
    {
      ownerUid: input.ownerUid,
      name: input.name,
      svg: input.svg,
      thumbnailDataUrl: input.thumbnailDataUrl,
      config: input.config,
      updatedAt: serverTimestamp(),
      // merge:true would leave a stale createdAt off an overwritten doc, so it
      // is only written when the record is new.
      ...(input.id ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true },
  );

  return ref.id;
}

export async function renameProject(id: string, name: string): Promise<void> {
  const store = requireDb();
  await updateDoc(doc(store, 'projects', id), { name, updatedAt: serverTimestamp() });
}

export async function deleteProject(id: string): Promise<void> {
  const store = requireDb();
  await deleteDoc(doc(store, 'projects', id));
}
