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
import { OrderFieldVersionEntity } from '../../database/entities';

@Injectable()
export class OrderFieldVersionRepository {
  constructor(
    @InjectRepository(OrderFieldVersionEntity)
    private readonly repository: Repository<OrderFieldVersionEntity>,
  ) {}

  create(
    data: DeepPartial<OrderFieldVersionEntity>,
  ): Promise<OrderFieldVersionEntity> {
    return this.repository.save(this.repository.create(data));
  }

  findAll(): Promise<OrderFieldVersionEntity[]> {
    return this.repository.find();
  }

  findBy(
    where:
      | FindOptionsWhere<OrderFieldVersionEntity>
      | FindOptionsWhere<OrderFieldVersionEntity>[],
  ): Promise<OrderFieldVersionEntity[]> {
    return this.repository.findBy(where);
  }

  findOneBy(
    where: FindOptionsWhere<OrderFieldVersionEntity>,
  ): Promise<OrderFieldVersionEntity | null> {
    return this.repository.findOneBy(where);
  }

  update(
    where:
      | FindOptionsWhere<OrderFieldVersionEntity>
      | FindOptionsWhere<OrderFieldVersionEntity>[],
    data: QueryDeepPartialEntity<OrderFieldVersionEntity>,
  ): Promise<UpdateResult> {
    return this.repository.update(where, data);
  }

  delete(
    where:
      | FindOptionsWhere<OrderFieldVersionEntity>
      | FindOptionsWhere<OrderFieldVersionEntity>[],
  ): Promise<DeleteResult> {
    return this.repository.delete(where);
  }
}
