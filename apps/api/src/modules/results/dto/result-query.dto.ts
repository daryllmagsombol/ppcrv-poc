import { IsOptional, IsString, IsIn } from 'class-validator';

export class ResultQueryDto {
  @IsString()
  @IsIn(['national', 'region', 'province', 'municipality', 'barangay', 'precinct'])
  level: string;

  @IsOptional()
  @IsString()
  reg?: string;

  @IsOptional()
  @IsString()
  prv?: string;

  @IsOptional()
  @IsString()
  mun?: string;

  @IsOptional()
  @IsString()
  brgy?: string;

  @IsOptional()
  @IsString()
  vc?: string;

  @IsOptional()
  @IsString()
  contest?: string;
}
