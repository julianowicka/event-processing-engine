import '../env';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { createTypeOrmOptions } from './typeorm.config';

export default new DataSource(createTypeOrmOptions() as DataSourceOptions);
