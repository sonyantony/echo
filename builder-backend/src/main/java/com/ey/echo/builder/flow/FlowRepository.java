package com.ey.echo.builder.flow;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface FlowRepository extends JpaRepository<Flow, Long> {

    boolean existsByNameIgnoreCase(String name);

    List<Flow> findAllByOrderByNameAsc();

    Optional<Flow> findByNameIgnoreCase(String name);
}
