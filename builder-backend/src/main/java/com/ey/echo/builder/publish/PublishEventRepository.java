package com.ey.echo.builder.publish;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PublishEventRepository extends JpaRepository<PublishEvent, Long> {

    List<PublishEvent> findByFlowIdOrderByPublishedAtDescIdDesc(Long flowId);

    Optional<PublishEvent> findFirstByFlowIdOrderByPublishedAtDescIdDesc(Long flowId);

    long countByFlowId(Long flowId);
}
