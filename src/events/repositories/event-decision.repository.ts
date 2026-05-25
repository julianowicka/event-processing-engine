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
import { EventDecisionEntity } from '../../database/entities';

@Injectable()
export class EventDecisionRepository {
  constructor(
    @InjectRepository(EventDecisionEntity)
    private readonly repository: Repository<EventDecisionEntity>,
  ) {}

  create(data: DeepPartial<EventDecisionEntity>): Promise<EventDecisionEntity> {
    return this.repository.save(this.repository.create(data));
  }

  findAll(): Promise<EventDecisionEntity[]> {
    return this.repository.find();
  }

  findBy(
    where:
      | FindOptionsWhere<EventDecisionEntity>
      | FindOptionsWhere<EventDecisionEntity>[],
  ): Promise<EventDecisionEntity[]> {
    return this.repository.findBy(where);
  }

  findOneBy(
    where: FindOptionsWhere<EventDecisionEntity>,
  ): Promise<EventDecisionEntity | null> {
    return this.repository.findOneBy(where);
  }

  update(
    where:
      | FindOptionsWhere<EventDecisionEntity>
      | FindOptionsWhere<EventDecisionEntity>[],
    data: QueryDeepPartialEntity<EventDecisionEntity>,
  ): Promise<UpdateResult> {
    return this.repository.update(where, data);
  }

  delete(
    where:
      | FindOptionsWhere<EventDecisionEntity>
      | FindOptionsWhere<EventDecisionEntity>[],
  ): Promise<DeleteResult> {
    return this.repository.delete(where);
  }
}
