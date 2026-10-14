package com.ey.echo.builder.flow;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface FlowRepository extends JpaRepository<Flow, Long> {

    boolean existsByNameIgnoreCase(String name);

    List<Flow> findAllByOrderByNameAsc();
}
