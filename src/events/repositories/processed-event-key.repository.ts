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
import { ProcessedEventKeyEntity } from '../../database/entities';

@Injectable()
export class ProcessedEventKeyRepository {
  constructor(
    @InjectRepository(ProcessedEventKeyEntity)
    private readonly repository: Repository<ProcessedEventKeyEntity>,
  ) {}

  create(
    data: DeepPartial<ProcessedEventKeyEntity>,
  ): Promise<ProcessedEventKeyEntity> {
    return this.repository.save(this.repository.create(data));
  }

  findAll(): Promise<ProcessedEventKeyEntity[]> {
    return this.repository.find();
  }

  findBy(
    where:
      | FindOptionsWhere<ProcessedEventKeyEntity>
      | FindOptionsWhere<ProcessedEventKeyEntity>[],
  ): Promise<ProcessedEventKeyEntity[]> {
    return this.repository.findBy(where);
  }

  findOneBy(
    where: FindOptionsWhere<ProcessedEventKeyEntity>,
  ): Promise<ProcessedEventKeyEntity | null> {
    return this.repository.findOneBy(where);
  }

  update(
    where:
      | FindOptionsWhere<ProcessedEventKeyEntity>
      | FindOptionsWhere<ProcessedEventKeyEntity>[],
    data: QueryDeepPartialEntity<ProcessedEventKeyEntity>,
  ): Promise<UpdateResult> {
    return this.repository.update(where, data);
  }

  delete(
    where:
      | FindOptionsWhere<ProcessedEventKeyEntity>
      | FindOptionsWhere<ProcessedEventKeyEntity>[],
  ): Promise<DeleteResult> {
    return this.repository.delete(where);
  }
}
