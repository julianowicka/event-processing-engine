import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEngineDatabase } from '../domain/types';

@Injectable()
export class JsonDatabaseService {
  private readonly filePath: string;

  constructor() {
    this.filePath =
      process.env.EVENT_ENGINE_DB_FILE ??
      path.join(process.cwd(), 'data', 'events-db.json');
    this.ensureDatabaseFile();
  }

  isReady(): boolean {
    return fs.existsSync(this.filePath);
  }

  read<T>(selector: (database: EventEngineDatabase) => T): T {
    return selector(this.load());
  }

  runInTransaction<T>(mutator: (database: EventEngineDatabase) => T): T {
    const database = this.load();
    const workingCopy = JSON.parse(
      JSON.stringify(database),
    ) as EventEngineDatabase;
    const result = mutator(workingCopy);
    this.save(workingCopy);
    return result;
  }

  reset(): void {
    this.save(createEmptyDatabase());
  }

  private ensureDatabaseFile(): void {
    const directory = path.dirname(this.filePath);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    if (!fs.existsSync(this.filePath)) {
      this.save(createEmptyDatabase());
    }
  }

  private load(): EventEngineDatabase {
    this.ensureDatabaseFile();
    const content = fs.readFileSync(this.filePath, 'utf8');
    return normalizeDatabase(JSON.parse(content) as EventEngineDatabase);
  }

  private save(database: EventEngineDatabase): void {
    const directory = path.dirname(this.filePath);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    fs.writeFileSync(this.filePath, `${JSON.stringify(database, null, 2)}\n`);
  }
}

function createEmptyDatabase(): EventEngineDatabase {
  const now = new Date().toISOString();

  return {
    nextIds: {
      rawIncomingEvent: 1,
      eventDecision: 1,
      orderHistory: 1,
      deadLetterEvent: 1,
    },
    rawIncomingEvents: [],
    processedEventKeys: [],
    orders: [],
    orderFieldVersions: [],
    orderHistory: [],
    eventDecisions: [],
    deadLetterEvents: [],
    stats: {
      validEventsCount: 0,
      acceptedEventsCount: 0,
      partiallyAppliedEventsCount: 0,
      rejectedEventsCount: 0,
      duplicateEventsCount: 0,
      processedEventsCount: 0,
      totalProcessingTimeMs: 0,
      updatedAt: now,
    },
  };
}

function normalizeDatabase(database: EventEngineDatabase): EventEngineDatabase {
  database.nextIds.deadLetterEvent ??= 1;
  database.deadLetterEvents ??= [];

  for (const raw of database.rawIncomingEvents) {
    raw.availableAt ??= raw.receivedAt;
    raw.attempts ??= 0;
    raw.lastErrorMessage ??= null;
  }

  return database;
}
