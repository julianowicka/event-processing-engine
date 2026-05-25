import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DeepPartial,
  DeleteResult,
  FindOptionsWhere,
  QueryDeepPartialEntity,
  Repository,
  UpdateResult,
} from 'typeorm';
import { EngineStatsEntity } from '../../database/entities';

@Injectable()
export class EngineStatsRepository {
  constructor(
    @InjectRepository(EngineStatsEntity)
    private readonly repository: Repository<EngineStatsEntity>,
  ) {}

  create(data: DeepPartial<EngineStatsEntity>): Promise<EngineStatsEntity> {
    return this.repository.save(this.repository.create(data));
  }

  findAll(): Promise<EngineStatsEntity[]> {
    return this.repository.find();
  }

  findBy(
    where:
      | FindOptionsWhere<EngineStatsEntity>
      | FindOptionsWhere<EngineStatsEntity>[],
  ): Promise<EngineStatsEntity[]> {
    return this.repository.findBy(where);
  }

  findOneBy(
    where: FindOptionsWhere<EngineStatsEntity>,
  ): Promise<EngineStatsEntity | null> {
    return this.repository.findOneBy(where);
  }

  update(
    where:
      | FindOptionsWhere<EngineStatsEntity>
      | FindOptionsWhere<EngineStatsEntity>[],
    data: QueryDeepPartialEntity<EngineStatsEntity>,
  ): Promise<UpdateResult> {
    return this.repository.update(where, data);
  }

  delete(
    where:
      | FindOptionsWhere<EngineStatsEntity>
      | FindOptionsWhere<EngineStatsEntity>[],
  ): Promise<DeleteResult> {
    return this.repository.delete(where);
  }
}
