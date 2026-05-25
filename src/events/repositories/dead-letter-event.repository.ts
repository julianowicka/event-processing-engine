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
import { DeadLetterEventEntity } from '../../database/entities';

@Injectable()
export class DeadLetterEventRepository {
  constructor(
    @InjectRepository(DeadLetterEventEntity)
    private readonly repository: Repository<DeadLetterEventEntity>,
  ) {}

  create(
    data: DeepPartial<DeadLetterEventEntity>,
  ): Promise<DeadLetterEventEntity> {
    return this.repository.save(this.repository.create(data));
  }

  findAll(): Promise<DeadLetterEventEntity[]> {
    return this.repository.find();
  }

  findBy(
    where:
      | FindOptionsWhere<DeadLetterEventEntity>
      | FindOptionsWhere<DeadLetterEventEntity>[],
  ): Promise<DeadLetterEventEntity[]> {
    return this.repository.findBy(where);
  }

  findOneBy(
    where: FindOptionsWhere<DeadLetterEventEntity>,
  ): Promise<DeadLetterEventEntity | null> {
    return this.repository.findOneBy(where);
  }

  update(
    where:
      | FindOptionsWhere<DeadLetterEventEntity>
      | FindOptionsWhere<DeadLetterEventEntity>[],
    data: QueryDeepPartialEntity<DeadLetterEventEntity>,
  ): Promise<UpdateResult> {
    return this.repository.update(where, data);
  }

  delete(
    where:
      | FindOptionsWhere<DeadLetterEventEntity>
      | FindOptionsWhere<DeadLetterEventEntity>[],
  ): Promise<DeleteResult> {
    return this.repository.delete(where);
  }
}
