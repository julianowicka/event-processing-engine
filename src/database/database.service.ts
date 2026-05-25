import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { getDatabasePath } from './typeorm.config';

@Injectable()
export class DatabaseService {
  readonly path = getDatabasePath();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  transaction<T>(
    operation: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(operation);
  }
}
