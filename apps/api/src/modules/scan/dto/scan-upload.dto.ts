import { IsString, IsBoolean, IsOptional } from 'class-validator';

export class ScanUploadDto {
  @IsString()
  precinct_id: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  province?: string;

  @IsOptional()
  @IsString()
  municipality?: string;

  @IsOptional()
  @IsString()
  barangay?: string;

  @IsOptional()
  @IsString()
  qr_raw_1?: string;

  @IsOptional()
  @IsString()
  qr_raw_2?: string;

  @IsOptional()
  @IsString()
  qr_raw_3?: string;

  @IsOptional()
  qr_parsed?: any;

  @IsOptional()
  db_results?: any;

  @IsOptional()
  @IsBoolean()
  has_discrepancy?: boolean;

  @IsOptional()
  discrepancy_details?: any;

  @IsOptional()
  @IsString()
  scanned_by?: string;
}
