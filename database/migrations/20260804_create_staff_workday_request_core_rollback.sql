-- WARNING: Never drop request lineage after real requests or published schedules depend on it.
DROP TABLE IF EXISTS staff_workday_request_days;
DROP TABLE IF EXISTS staff_workday_requests;
